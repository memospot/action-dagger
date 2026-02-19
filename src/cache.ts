import * as fs from "node:fs";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { getAvailableDiskSpace } from "./disk-space";
import * as engine from "./engine";
import { calculateRequiredSpace, generateEngineToml, writeEngineConfig } from "./engine-config";
import { isOperationCancelledError } from "./operation-cancelled-error";
import { withInterruptibleTimeout, withTimeout } from "./timeout";

const DAGGER_ENGINE_VOLUME = "dagger-engine-vol";

/**
 * Cache configuration for Dagger build cache
 */
export interface CacheConfig {
    /** Cache key for build cache */
    key: string;
    /** Paths to cache */
    paths: string[];
    /** Restore keys for partial matches */
    restoreKeys: string[];
}

const CACHE_DIR_NAME = "dagger-engine-state";
const CACHE_ARCHIVE_FILE_NAME = "dagger-engine-state.tar";
const DEFAULT_CACHE_PREFIX = "dagger";
const IMAGE_PULL_WAIT_TIMEOUT_MS = 120_000;

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
}

/**
 * Get the standardized cache directory path
 */
function getCacheDir(): string {
    const tempDir = process.env.RUNNER_TEMP || "/tmp";
    return path.join(tempDir, CACHE_DIR_NAME);
}

/**
 * Generate cache key.
 * If customKey is provided, use it.
 * Otherwise generate a default rolling key: dagger-{os}-{arch}-{run_id}
 */
function getCacheKey(customKey?: string): string {
    if (customKey) {
        return customKey;
    }

    // Default rolling key
    const runId = process.env.GITHUB_RUN_ID || "unknown";
    return `${DEFAULT_CACHE_PREFIX}-${process.arch}-${runId}`;
}

/**
 * Get restore keys.
 * If customKey is provided: [customKey without last segment]
 * Otherwise (default): [dagger-{os}-{arch}-]
 */
function getRestoreKeys(key: string): string[] {
    const lastDash = key.lastIndexOf("-");
    if (lastDash === -1) {
        return [];
    }
    return [key.substring(0, lastDash)];
}

/**
 * Cleanup cache path (file or directory)
 */
function cleanupCachePath(cachePath: string): void {
    if (fs.existsSync(cachePath)) {
        try {
            // Check if it's a directory or file
            const stats = fs.statSync(cachePath);
            if (stats.isDirectory()) {
                fs.rmSync(cachePath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(cachePath);
            }
            core.debug(`Cleaned up cache path: ${cachePath}`);
        } catch (cleanupError) {
            core.debug(`Failed to clean up cache path: ${cleanupError}`);
        }
    }
}

/**
 * Extract an archive that is already strictly inside the engine volume
 * This is used when we restore a fallback cache (tarball) into the volume directly
 */
async function extractInternalArchive(
    volumeName: string,
    internalArchivePath: string
): Promise<void> {
    core.info(`📦 Found fallback archive in volume, extracting...`);

    // We mount the volume to itself? No, we just run a container with the volume.
    // The file is at /data/<internalArchivePath> (rel to volume root)
    const cmd = `cd /data && tar -xf ${internalArchivePath} && rm ${internalArchivePath}`;

    try {
        await exec.exec(
            "docker",
            ["run", "--rm", "-v", `${volumeName}:/data`, "busybox", "sh", "-c", cmd],
            { silent: true }
        );
        core.info("✓ Extracted fallback archive inside volume");
    } catch (error) {
        throw new Error(`Failed to extract internal archive: ${error}`);
    }
}

/**
 * Setup Dagger cache by restoring the engine state volume
 * Strategy depends on cacheMode:
 * - 'direct': Only try direct mount (Optimistic Mount)
 * - 'container': Only try container tarball restore
 * - 'auto': Try direct first, fallback to container (Smart Strategy)
 */
/**
 * Check if we should skip saving the cache
 */
export function shouldSkipSave(restoredKey: string, keyToSave: string): boolean {
    if (restoredKey && restoredKey === keyToSave) {
        core.info(
            `Cache already exists for key "${keyToSave}" - skipping save (cache is immutable)`
        );
        return true;
    }
    return false;
}

/**
 * Check if there is enough disk space for cache save
 */
export async function hasEnoughDiskSpace(cacheDirParent: string): Promise<boolean> {
    const availableSpace = await getAvailableDiskSpace(cacheDirParent);
    const volumeSize = await engine.getVolumeSize(DAGGER_ENGINE_VOLUME);
    const MIN_REQUIRED_SPACE = 3 * 1024 * 1024 * 1024; // 3GB

    core.info(`📦 Engine volume size: ${formatBytes(volumeSize)}`);
    if (availableSpace > 0 && availableSpace < MIN_REQUIRED_SPACE) {
        core.warning(`Low disk space (${formatBytes(availableSpace)}). Skipping cache save.`);
        return false;
    }
    return true;
}

/**
 * Attempt to save cache via direct volume mount
 */
export async function attemptDirectSave(
    key: string,
    timeoutMinutes: number,
    cacheDir: string
): Promise<boolean> {
    try {
        core.info("📦 Attempting Direct Cache Save…");
        await engine.mountVolume(DAGGER_ENGINE_VOLUME, cacheDir);

        if (timeoutMinutes > 0) {
            const timeoutMs = timeoutMinutes * 60 * 1000;
            await withInterruptibleTimeout(
                cache.saveCache([cacheDir], key),
                timeoutMs,
                "Direct Cache Save",
                () => {
                    core.warning(
                        "Direct cache save timed out; active upload cannot be force-interrupted"
                    );
                }
            );
        } else {
            await cache.saveCache([cacheDir], key);
        }

        core.info("✓ Cache saved via Direct Mount");
        return true;
    } catch (error) {
        core.warning(`Direct cache save failed: ${error}`);
        return false;
    } finally {
        await engine.unmountVolume(cacheDir);
    }
}

/**
 * Attempt to save cache via container backup
 */
export async function attemptContainerSave(
    key: string,
    timeoutMinutes: number,
    cacheDir: string
): Promise<boolean> {
    try {
        core.info("📦 Attempting Container Cache Save…");

        // Ensure cacheDir exists and is empty/ready
        cleanupCachePath(cacheDir);
        fs.mkdirSync(cacheDir, { recursive: true });

        const archivePath = path.join(cacheDir, CACHE_ARCHIVE_FILE_NAME);
        const backupAbortController = new AbortController();

        // Generate tarball into the cacheDir
        if (timeoutMinutes > 0) {
            const timeoutMs = timeoutMinutes * 60 * 1000;
            await withInterruptibleTimeout(
                engine.backupEngineVolume(DAGGER_ENGINE_VOLUME, archivePath, {
                    verbose: core.isDebug(),
                    abortSignal: backupAbortController.signal,
                }),
                timeoutMs,
                "Cache Backup",
                () => {
                    backupAbortController.abort();
                }
            );
        } else {
            await engine.backupEngineVolume(DAGGER_ENGINE_VOLUME, archivePath, {
                verbose: core.isDebug(),
                abortSignal: backupAbortController.signal,
            });
        }

        // Save the directory containing the tarball
        core.info(`Uploading archive to cache with key: ${key}`);
        await cache.saveCache([cacheDir], key);
        core.info("✓ Cache saved via Container Backup");
        return true;
    } catch (error) {
        if (isOperationCancelledError(error)) {
            throw error;
        }

        core.warning(`Container cache save failed: ${error}`);
        return false;
    }
}

/**
 * Cleanup after save operation
 */
export async function cleanupSave(cacheDir: string, startTime: number): Promise<void> {
    core.info("🧹 Deleting engine volume…");
    await engine.deleteEngineVolume(DAGGER_ENGINE_VOLUME);

    const duration = Date.now() - startTime;
    core.info(`⏱️ Total cache save operation completed in ${duration}ms`);
    cleanupCachePath(cacheDir);
}

/**
 * Determine restore strategy based on mode
 */
export function determineRestoreStrategy(mode: string): {
    tryDirect: boolean;
    tryContainer: boolean;
} {
    return {
        tryDirect: mode === "direct" || mode === "auto",
        tryContainer: mode === "container" || mode === "auto",
    };
}

/**
 * Attempt to restore cache via direct volume mount
 */
export async function attemptDirectRestore(
    primaryKey: string,
    restoreKeys: string[],
    cacheDir: string
): Promise<string | undefined> {
    try {
        core.info("📦 Attempting Direct Cache Restore…");
        await engine.mountVolume(DAGGER_ENGINE_VOLUME, cacheDir);

        const restoredKey = await cache.restoreCache([cacheDir], primaryKey, restoreKeys);

        if (restoredKey) {
            core.info(`✓ Restored engine cache from key: ${restoredKey}`);

            // Check for Fallback Archive (dagger-engine-state.tar)
            const archivePath = path.join(cacheDir, CACHE_ARCHIVE_FILE_NAME);
            if (fs.existsSync(archivePath)) {
                await extractInternalArchive(DAGGER_ENGINE_VOLUME, CACHE_ARCHIVE_FILE_NAME);
            } else {
                core.info("✓ Engine volume hydrated via direct host mount");
            }
            return restoredKey;
        }

        core.info("No cache found (direct)");
        return undefined;
    } catch (error) {
        core.warning(`Direct cache restore failed: ${error}`);
        // We throw so the parent knows it failed (vs just not found)
        throw error;
    } finally {
        await engine.unmountVolume(cacheDir);
        // We do NOT cleanup cache path here, as it might be needed for container/fallback?
        // Actually, for direct mount, the cacheDir IS the volume mount point.
        // Once unmounted, it's just an empty dir (or should be).
        cleanupCachePath(cacheDir);
    }
}

/**
 * Attempt to restore cache via container archive
 */
export async function attemptContainerRestore(
    primaryKey: string,
    restoreKeys: string[],
    cacheDir: string
): Promise<string | undefined> {
    try {
        core.info("📦 Attempting Container Cache Restore…");

        cleanupCachePath(cacheDir);
        fs.mkdirSync(cacheDir, { recursive: true });

        const restoredKey = await cache.restoreCache([cacheDir], primaryKey, restoreKeys);

        if (restoredKey) {
            core.info(`✓ Restored engine cache from key: ${restoredKey}`);

            const archivePath = path.join(cacheDir, CACHE_ARCHIVE_FILE_NAME);
            if (fs.existsSync(archivePath)) {
                await engine.restoreEngineVolume(DAGGER_ENGINE_VOLUME, archivePath);
                core.info("✓ Engine volume hydrated via container extraction");
                return restoredKey;
            }

            core.warning("Cache restored but no archive found in cache directory");
            // Treat missing archive as failure? Or just empty cache?
            // Existing logic treated it as success but with a warning.
            return restoredKey;
        }

        core.info("No cache found (container)");
        return undefined;
    } catch (error) {
        core.warning(`Container cache restore failed: ${error}`);
        // We swallow error here usually, but let's be consistent
        return undefined;
    } finally {
        cleanupCachePath(cacheDir);
    }
}

/**
 * Setup Dagger cache by restoring the engine state volume
 */
export async function setupDaggerCache(
    daggerVersion: string,
    cacheKeyInput?: string,
    cacheMode: "auto" | "direct" | "container" = "auto",
    imagePullPromise?: Promise<void>
): Promise<void> {
    const startTime = Date.now();
    core.info(`🗡️ Setting up Dagger Engine cache (mode: ${cacheMode})…`);
    core.debug(`lifecycle:cache:setup:start version=${daggerVersion} mode=${cacheMode}`);

    const primaryKey = getCacheKey(cacheKeyInput);
    const restoreKeys = getRestoreKeys(primaryKey);
    const cacheDir = getCacheDir();

    // Ensure volume exists
    await exec.exec("docker", ["volume", "create", DAGGER_ENGINE_VOLUME], { silent: true });

    let restoredKey: string | undefined;
    const { tryDirect, tryContainer } = determineRestoreStrategy(cacheMode);
    let directAttemptedAndMissed = false;

    if (tryDirect) {
        try {
            restoredKey = await attemptDirectRestore(primaryKey, restoreKeys, cacheDir);
            if (!restoredKey) {
                directAttemptedAndMissed = true;
            }
        } catch (error) {
            core.warning(`Direct restore failed: ${error}`);
            // Only fallback if we are in auto mode (if direct failed in direct mode, we stop)
            if (!tryContainer) {
                // Should we cleanup here? The finally block in attemptDirectRestore already did unmount/cleanup
            }
        }
    }

    if (!restoredKey && tryContainer && !directAttemptedAndMissed) {
        // If direct failed or wasn't attempted, and we should try container
        // We skip if direct was attempted and simply missed (to avoid double lookup)
        restoredKey = await attemptContainerRestore(primaryKey, restoreKeys, cacheDir);
    }

    let hasCacheHit = false;
    let estimatedUncompressedSize: number | undefined;
    let configPath: string | undefined;

    if (restoredKey) {
        // Check if we have enough disk space for the restored cache
        const archivePath = path.join(cacheDir, CACHE_ARCHIVE_FILE_NAME);
        if (fs.existsSync(archivePath)) {
            const archiveStats = fs.statSync(archivePath);
            const requiredSpace = calculateRequiredSpace(archiveStats.size);
            const availableSpace = await getAvailableDiskSpace(cacheDir);

            core.info(`📦 Cache archive: ${formatBytes(archiveStats.size)}`);
            core.info(`💾 Required space: ${formatBytes(requiredSpace)}`);
            core.info(`💾 Available space: ${formatBytes(availableSpace)}`);

            if (availableSpace >= requiredSpace) {
                hasCacheHit = true;
                estimatedUncompressedSize = Math.ceil(archiveStats.size * 3.5); // Estimate uncompressed
                core.saveState("CACHE_RESTORED_KEY", restoredKey);
                core.info(`✓ Cache restored successfully: ${restoredKey}`);
            } else {
                core.warning(`Insufficient disk space for cache extraction. Starting fresh.`);
                hasCacheHit = false;
            }
        } else {
            // Direct mount succeeded without archive
            hasCacheHit = true;
            core.saveState("CACHE_RESTORED_KEY", restoredKey);
            core.info(`✓ Cache restored via direct mount: ${restoredKey}`);
        }
    } else {
        core.info("No cache found, starting with fresh engine volume");
        hasCacheHit = false;
    }

    // Generate engine.toml based on cache configuration
    const engineTomlContent = generateEngineToml(hasCacheHit, estimatedUncompressedSize);
    configPath = writeEngineConfig(engineTomlContent);

    if (hasCacheHit && estimatedUncompressedSize) {
        const maxUsedSpaceGb = Math.ceil(
            (estimatedUncompressedSize * 1.5) / (1024 * 1024 * 1024)
        );
        core.info(
            `⚙️ Using dynamic GC policy: max ${maxUsedSpaceGb}GB (cache × 1.5), min 15% free`
        );
    } else {
        core.info(`⚙️ Using static GC policy: max 75%, min 20% free (fresh start)`);
    }
    core.debug(`Generated engine config at ${configPath}`);

    // If cache restored successfully and image pull is in progress, wait for it
    // This ensures the image is ready before starting the engine, avoiding delay
    if (hasCacheHit && imagePullPromise) {
        core.debug("Cache restored, waiting for background image pull to complete…");
        try {
            await withTimeout(
                imagePullPromise,
                IMAGE_PULL_WAIT_TIMEOUT_MS,
                "Background image pull"
            );
            core.debug("Background image pull completed");
        } catch (error) {
            core.warning(`Background image pull wait timed out: ${error}`);
            core.info("Continuing engine startup without waiting for image pull");
        }
    }

    // Always start the engine
    core.info(`🚀 Starting Dagger Engine (${daggerVersion})…`);
    try {
        await engine.startEngine(DAGGER_ENGINE_VOLUME, daggerVersion, configPath);

        const runnerHost = "docker-container://dagger-engine.dev";
        core.exportVariable("_EXPERIMENTAL_DAGGER_RUNNER_HOST", runnerHost);
        core.exportVariable("DAGGER_RUNNER_HOST", runnerHost);
        core.info(`✓ Dagger Engine started and configured at ${runnerHost}`);
    } catch (error) {
        core.error(`Failed to start Dagger Engine: ${error}`);
    }

    const duration = Date.now() - startTime;
    core.debug(`lifecycle:cache:setup:end duration=${duration}ms`);
}

/**
 * Save Dagger cache by backing up the engine state volume
 */
export async function saveDaggerCache(
    cacheBuilds: boolean,
    cacheKeyInput?: string,
    timeoutMinutes: number = 10,
    cacheMode: "auto" | "direct" | "container" = "auto"
): Promise<void> {
    const startTime = Date.now();
    core.info(`💾 Saving Dagger Engine cache (mode: ${cacheMode})…`);
    core.debug(`lifecycle:cache:save:start mode=${cacheMode}`);

    // Early exit if cache builds are disabled entirely
    if (!cacheBuilds) {
        core.info("📦 Build cache disabled, skipping all cache operations");
        return;
    }

    const keyToSave = getCacheKey(cacheKeyInput);
    const restoredKey = core.getState("CACHE_RESTORED_KEY");
    const cacheDir = getCacheDir();

    try {
        // 1. Identify Engine
        const containerId = await engine.findEngineContainer();
        if (!containerId) {
            core.info("No Dagger Engine container found to cache.");
            return;
        }

        // 2. ALWAYS PRUNE first (before checking immutability)
        // This ensures cache is cleaned even if we're not saving (static key hit)
        core.info("🧹 Pruning Dagger engine local cache…");
        try {
            await exec.exec(
                "dagger",
                ["core", "engine", "local-cache", "prune", "--use-default-policy"],
                {
                    silent: true,
                }
            );
            core.info("✓ Cache prune completed");
        } catch (pruneError) {
            core.warning(`Cache prune failed (non-critical): ${pruneError}`);
            // Continue anyway - this is not a fatal error
        }

        // 3. Check if immutable AFTER pruning
        if (shouldSkipSave(restoredKey, keyToSave)) {
            core.info("📦 Cache immutable, stopping engine without saving");
            await engine.stopEngine(containerId);
            return;
        }

        // 4. Stop Engine
        core.info(`Stopping engine container ${containerId}…`);
        await engine.stopEngine(containerId);

        // 5. Check Disk Space
        if (!(await hasEnoughDiskSpace(path.dirname(cacheDir)))) {
            return;
        }

        // 6. Attempt Save
        let saved = false;
        const { tryDirect, tryContainer } = determineRestoreStrategy(cacheMode); // logic for save same as restore

        if (tryDirect) {
            saved = await attemptDirectSave(keyToSave, timeoutMinutes, cacheDir);
        }

        if (!saved && tryContainer) {
            if (tryDirect) {
                core.info("⚠️ Falling back to Container Save…");
            }
            saved = await attemptContainerSave(keyToSave, timeoutMinutes, cacheDir);
        }
    } catch (error) {
        if (isOperationCancelledError(error)) {
            core.info("Cache save cancelled, exiting early without fallback/upload");
            return;
        }

        core.warning(`Failed to save cache: ${error}`);
    } finally {
        await cleanupSave(cacheDir, startTime);
    }
}
