import * as fs from "node:fs";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { getAvailableDiskSpace } from "./disk-space";
import * as engine from "./engine";
import { withTimeout } from "./timeout";

const DAGGER_ENGINE_VOLUME = "dagger-engine-vol";
const CACHE_ARCHIVE_NAME_ZSTD = "dagger-engine-state.tar.zst";
const CACHE_ARCHIVE_NAME_TAR = "dagger-engine-state.tar";
const DEFAULT_CACHE_PREFIX = "dagger-v1";

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
 * Get the path where we store the cache archive
 * @param compressionLevel - Compression level (0 = plain tar, 1-19 = zstd)
 * @returns Full path to the archive file with appropriate extension
 */
function getCacheArchivePath(compressionLevel: number): string {
    const tempDir = process.env.RUNNER_TEMP || "/tmp";
    const archiveName =
        compressionLevel === 0 ? CACHE_ARCHIVE_NAME_TAR : CACHE_ARCHIVE_NAME_ZSTD;
    return path.join(tempDir, archiveName);
}

/**
 * Generate cache key.
 * If customKey is provided, use it.
 * Otherwise generate a default rolling key: dagger-v1-{os}-{arch}-{run_id}
 */
function getCacheKey(customKey?: string): string {
    if (customKey) {
        return customKey;
    }

    // Default rolling key
    const runId = process.env.GITHUB_RUN_ID || "unknown";
    return `${DEFAULT_CACHE_PREFIX}-${process.platform}-${process.arch}-${runId}`;
}

/**
 * Get restore keys.
 * If customKey is provided: [customKey without last segment]
 * Otherwise (default): [dagger-v1-{os}-{arch}-]
 */
function getRestoreKeys(key: string): string[] {
    const lastDash = key.lastIndexOf("-");
    if (lastDash === -1) {
        return [];
    }
    return [key.substring(0, lastDash)];
}

/**
 * Setup Dagger cache by restoring the engine state volume
 */
export async function setupDaggerCache(
    daggerVersion: string,
    cacheKeyInput?: string,
    compressionLevel = 0
): Promise<void> {
    const startTime = Date.now();
    core.info("🗡️ Setting up Dagger Engine cache…");
    core.debug(`lifecycle:cache:setup:start version=${daggerVersion}`);

    const cachePath = getCacheArchivePath(compressionLevel);
    // Verify directory exists (it should, as getCacheArchivePath uses RUNNER_TEMP)
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Determine keys
    const primaryKey = getCacheKey(cacheKeyInput);
    const restoreKeys = getRestoreKeys(primaryKey);

    core.debug(`Restore keys: ${JSON.stringify(restoreKeys)}`);

    try {
        // We restore the *file* (tarball)
        // We restore using the restore keys (prefix match)
        const restoredKey = await cache.restoreCache([cachePath], primaryKey, restoreKeys);
        if (restoredKey) {
            core.info(`✓ Restored engine cache archive from key: ${restoredKey}`);

            // Track which key was restored so we can skip save if the same key would be used
            // GitHub Actions caches are immutable - saving with the same key would fail
            core.saveState("CACHE_RESTORED_KEY", restoredKey);
            core.debug(
                `Cache restored with key: ${restoredKey} - save will be skipped if same key`
            );

            // Restore volume from archive
            core.info("📦 Hydrating Dagger Engine volume from cache…");
            await engine.restoreEngineVolume(DAGGER_ENGINE_VOLUME, cachePath);
            core.info("✓ Engine volume hydrated");

            // Clean up the archive file to free space and avoid conflicts
            try {
                fs.unlinkSync(cachePath);
                core.debug("Cleaned up cache archive file");
            } catch {
                // Ignore cleanup errors
            }
        } else {
            core.info("No cache found, starting with fresh engine volume");
        }
    } catch (error) {
        core.warning(`Failed to restore cache: ${error}`);
    }

    // Always start the engine with our volume (empty or hydrated)
    core.info(`🚀 Starting Dagger Engine (${daggerVersion})…`);
    try {
        await engine.startEngine(DAGGER_ENGINE_VOLUME, daggerVersion);

        // Configure CLI to use this engine
        const runnerHost = "docker-container://dagger-engine.dev";
        core.exportVariable("_EXPERIMENTAL_DAGGER_RUNNER_HOST", runnerHost);
        core.exportVariable("DAGGER_RUNNER_HOST", runnerHost); // for future compatibility.
        core.info(`✓ Dagger Engine started and configured at ${runnerHost}`);
    } catch (error) {
        core.error(`Failed to start Dagger Engine: ${error}`);
        // We don't throw here to allow fallback to CLI-spawned engine (though it won't have cache)
    }

    const duration = Date.now() - startTime;
    core.debug(`lifecycle:cache:setup:end duration=${duration}ms`);
}

/**
 * Save Dagger cache by backing up the engine state volume
 */
export async function saveDaggerCache(
    cacheKeyInput?: string,
    timeoutMinutes: number = 10,
    compressionLevel = 0
): Promise<void> {
    const startTime = Date.now();
    core.info("💾 Saving Dagger Engine cache…");
    core.debug(`lifecycle:cache:save:start`);

    // Check if we restored from cache with the same key we would save to
    // GitHub Actions caches are immutable - saving with the same key would fail
    const restoredKey = core.getState("CACHE_RESTORED_KEY");
    const keyToSave = getCacheKey(cacheKeyInput);
    if (restoredKey && restoredKey === keyToSave) {
        core.info(
            `Cache already exists for key "${keyToSave}" - skipping save (cache is immutable)`
        );
        core.debug(`lifecycle:cache:save:skipped reason=cache_exists key=${keyToSave}`);
        return;
    }

    let cachePath = "";

    try {
        // 1. Identify engine
        const containerId = await engine.findEngineContainer();

        if (!containerId) {
            core.info("No Dagger Engine container found to cache.");
            return;
        }

        // 2. Stop engine to ensure consistent state
        core.info(`Stopping engine container ${containerId}…`);
        await engine.stopEngine(containerId);

        // 3. Determine archive path based on compression level
        cachePath = getCacheArchivePath(compressionLevel);

        // 4. Log disk space before save and get volume size
        const availableSpaceBefore = await getAvailableDiskSpace(path.dirname(cachePath));
        core.info(`💾 Free disk space before save: ${formatBytes(availableSpaceBefore)}`);

        // Get volume size before backup
        const volumeSize = await engine.getVolumeSize(DAGGER_ENGINE_VOLUME);
        core.info(`📦 Engine volume size: ${formatBytes(volumeSize)}`);

        // Check disk space
        // We require at least 3GB of free space to perform the backup safely.
        // This is a conservative estimate to handle the compressed volume and avoid failing the workflow.
        const MIN_REQUIRED_SPACE = 3 * 1024 * 1024 * 1024; // 3GB

        if (availableSpaceBefore > 0 && availableSpaceBefore < MIN_REQUIRED_SPACE) {
            core.warning(
                `Low disk space detected (${formatBytes(availableSpaceBefore)}). Skipping cache backup to prevent failure.`
            );
            core.info("✅ Continuing without cache save (Soft Fail)");
            return;
        }

        core.info(
            `📦 Extracting engine volume to archive (compression level ${compressionLevel})…`
        );

        // 5. Backup volume with optional timeout
        if (timeoutMinutes > 0) {
            const timeoutMs = timeoutMinutes * 60 * 1000;
            await withTimeout(
                engine.backupEngineVolume(DAGGER_ENGINE_VOLUME, cachePath, {
                    verbose: core.isDebug(),
                    compressionLevel,
                }),
                timeoutMs,
                "Cache backup"
            );
        } else {
            await engine.backupEngineVolume(DAGGER_ENGINE_VOLUME, cachePath, {
                verbose: core.isDebug(),
                compressionLevel,
            });
        }

        // 6. Save to GHA cache
        if (fs.existsSync(cachePath)) {
            const stats = fs.statSync(cachePath);
            core.info(`📊 Archive size: ${formatBytes(stats.size)}`);

            // Use the primary unique key for saving
            const key = getCacheKey(cacheKeyInput);
            core.info(`Uploading to cache with key: ${key}`);
            await cache.saveCache([cachePath], key);
            core.info("✓ Cache saved");

            // 7. Log disk space after save
            const availableSpaceAfter = await getAvailableDiskSpace(path.dirname(cachePath));
            core.info(`💾 Free disk space after save: ${formatBytes(availableSpaceAfter)}`);

            // 8. Prune volume to free space
            core.info("🧹 Pruning engine volume…");
            await engine.deleteEngineVolume(DAGGER_ENGINE_VOLUME);
            core.info("✓ Volume pruned");
        } else {
            core.warning("Archive file not created.");
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes("timed out")) {
            core.warning(`⚠️ ${error.message} - skipping to avoid blocking workflow`);
            core.info("✅ Continuing without cache save");
            return;
        }
        core.warning(`Failed to save cache: ${error}`);
    } finally {
        const duration = Date.now() - startTime;
        core.debug(`lifecycle:cache:save:end duration=${duration}ms`);

        // Always clean up the archive file to prevent disk space accumulation
        if (cachePath && fs.existsSync(cachePath)) {
            try {
                fs.unlinkSync(cachePath);
                core.debug(`Cleaned up archive file: ${cachePath}`);
            } catch (cleanupError) {
                core.debug(`Failed to clean up archive file: ${cleanupError}`);
            }
        }
    }
}
