import * as fs from "node:fs";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as engine from "./engine.js";
import { getAvailableDiskSpace, withTimeout } from "./utils.js";

const DAGGER_ENGINE_VOLUME = "dagger-engine-vol";
const CACHE_ARCHIVE_NAME = "dagger-engine-state.tar.zst";
const DEFAULT_CACHE_PREFIX = "dagger-v1";

/**
 * Get the path where we store the cache archive
 */
function getCacheArchivePath(): string {
    const tempDir = process.env.RUNNER_TEMP || "/tmp";
    return path.join(tempDir, CACHE_ARCHIVE_NAME);
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
    cacheKeyInput?: string
): Promise<void> {
    core.info("🗡️ Setting up Dagger Engine cache...");

    const cachePath = getCacheArchivePath();
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

            // Restore volume from archive
            core.info("📦 Hydrating Dagger Engine volume from cache...");
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
    core.info(`🚀 Starting Dagger Engine (${daggerVersion})...`);
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
}

/**
 * Save Dagger cache by backing up the engine state volume
 */
export async function saveDaggerCache(
    cacheKeyInput?: string,
    timeoutMinutes: number = 10
): Promise<void> {
    core.info("💾 Saving Dagger Engine cache...");

    try {
        // 1. Identify engine
        const containerId = await engine.findEngineContainer();

        if (!containerId) {
            core.info("No Dagger Engine container found to cache.");
            return;
        }

        // 2. Stop engine to ensure consistent state
        core.info(`Stopping engine container ${containerId}...`);
        await engine.stopEngine(containerId);

        // 3. Backup volume with optional timeout
        const cachePath = getCacheArchivePath();

        // 3. Check disk space
        // We require at least 3GB of free space to perform the backup safely.
        // This is a conservative estimate to handle the compressed volume and avoid failing the workflow.
        const availableSpace = await getAvailableDiskSpace(path.dirname(cachePath));
        const MIN_REQUIRED_SPACE = 3 * 1024 * 1024 * 1024; // 3GB

        if (availableSpace > 0 && availableSpace < MIN_REQUIRED_SPACE) {
            core.warning(
                `Low disk space detected (${(availableSpace / 1024 / 1024).toFixed(0)}MB). Skipping cache backup to prevent failure.`
            );
            core.info("✅ Continuing without cache save (Soft Fail)");
            return;
        }

        core.info("📦 Extracting engine volume to archive (zstd streamed)...");

        if (timeoutMinutes > 0) {
            const timeoutMs = timeoutMinutes * 60 * 1000;
            await withTimeout(
                engine.backupEngineVolume(DAGGER_ENGINE_VOLUME, cachePath, {
                    verbose: core.isDebug(),
                }),
                timeoutMs,
                "Cache backup"
            );
        } else {
            await engine.backupEngineVolume(DAGGER_ENGINE_VOLUME, cachePath, {
                verbose: core.isDebug(),
            });
        }

        // 4. Save to GHA cache
        if (fs.existsSync(cachePath)) {
            const stats = fs.statSync(cachePath);
            core.info(`📊 Archive size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

            // Use the primary unique key for saving
            const key = getCacheKey(cacheKeyInput);
            core.info(`Uploading to cache with key: ${key}`);
            await cache.saveCache([cachePath], key);
            core.info("✓ Cache saved");

            // 5. Prune volume to free space
            core.info("🧹 Pruning engine volume...");
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
    }
}
