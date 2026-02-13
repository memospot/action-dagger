import * as fs from "node:fs";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as engine from "./engine.js";

const DAGGER_ENGINE_VOLUME = "dagger-engine-vol";
const CACHE_ARCHIVE_NAME = "dagger-engine-state.tar";
const DEFAULT_CACHE_VERSION = "v2";

/**
 * Get the path where we store the cache archive
 */
function getCacheArchivePath(): string {
    const tempDir = process.env.RUNNER_TEMP || "/tmp";
    return path.join(tempDir, CACHE_ARCHIVE_NAME);
}

/**
 * Generate cache key based on repository, branch, Dagger version, and cache version
 */
function getCacheKey(daggerVersion: string, cacheVersion: string): string {
    const workflow = process.env.GITHUB_WORKFLOW || "unknown";
    const repository = process.env.GITHUB_REPOSITORY || "unknown";
    // We include dagger version because internal state format might change
    // cacheVersion allows users to invalidate caches when needed
    return `dagger-buildkit-${cacheVersion}-${process.platform}-${daggerVersion}-${repository}-${workflow}`;
}

/**
 * Setup Dagger cache by restoring the engine state volume
 */
export async function setupDaggerCache(
    daggerVersion: string,
    cacheVersion: string = DEFAULT_CACHE_VERSION
): Promise<void> {
    core.info("🗡️ Setting up Dagger Engine cache...");

    const cachePath = getCacheArchivePath();
    // Verify directory exists (it should, as getCacheArchivePath uses RUNNER_TEMP)
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    const key = getCacheKey(daggerVersion, cacheVersion);
    const restoreKeys = [
        `dagger-buildkit-${cacheVersion}-${process.platform}-${daggerVersion}-${process.env.GITHUB_REPOSITORY}-`,
        `dagger-buildkit-${cacheVersion}-${process.platform}-${daggerVersion}-`,
    ];

    try {
        // We restore the *file* (tarball)
        const restoredKey = await cache.restoreCache([cachePath], key, restoreKeys);
        if (restoredKey) {
            core.info(`✓ Restored engine cache archive from key: ${restoredKey}`);

            // Restore volume from archive
            core.info("📦 Hydrating Dagger Engine volume from cache...");
            await engine.restoreEngineVolume(DAGGER_ENGINE_VOLUME, cachePath);
            core.info("✓ Engine volume hydrated");
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
    daggerVersion: string,
    cacheVersion: string = DEFAULT_CACHE_VERSION
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

        // 3. Backup volume
        const cachePath = getCacheArchivePath();
        core.info("📦 Extracting engine volume to archive...");
        await engine.backupEngineVolume(DAGGER_ENGINE_VOLUME, cachePath);

        // 4. Save to GHA cache
        if (fs.existsSync(cachePath)) {
            const stats = fs.statSync(cachePath);
            core.info(`Archive size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

            const key = getCacheKey(daggerVersion, cacheVersion);
            core.info(`Uploading to cache with key: ${key}`);
            await cache.saveCache([cachePath], key);
            core.info("✓ Cache saved");
        } else {
            core.warning("Archive file not created.");
        }
    } catch (error) {
        core.warning(`Failed to save cache: ${error}`);
    }
}
