import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import type { CacheConfig } from "./types.js";
import { logDebug, logInfo, logWarning } from "./utils.js";

const CACHE_DIR_NAME = ".dagger-cache";
const CACHE_STATE_KEY = "DAGGER_CACHE_KEY";
const CACHE_PATHS_KEY = "DAGGER_CACHE_PATHS";

/**
 * Setup Dagger build cache - restore from GitHub Actions Cache
 */
export async function setupDaggerCache(): Promise<void> {
    const cacheDir = getCacheDirectory();

    // Ensure cache directory exists
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Generate cache key
    const cacheConfig = generateCacheConfig(cacheDir);

    logInfo(`Restoring Dagger build cache...`);
    logDebug(`Cache key: ${cacheConfig.key}`);
    logDebug(`Cache paths: ${cacheConfig.paths.join(", ")}`);

    try {
        const cacheKey = await cache.restoreCache(
            cacheConfig.paths,
            cacheConfig.key,
            cacheConfig.restoreKeys
        );

        if (cacheKey) {
            logInfo(`✓ Restored build cache: ${cacheKey}`);
        } else {
            logInfo("No build cache found");
        }

        // Save state for post action
        core.saveState(CACHE_STATE_KEY, cacheConfig.key);
        core.saveState(CACHE_PATHS_KEY, JSON.stringify(cacheConfig.paths));

        // Set environment variable for Dagger CLI
        // We set both the experimental env var (for older versions) and the standard one
        const cacheConfigEnv = `type=local,src=${cacheDir},dest=${cacheDir},mode=max`;
        core.exportVariable("_EXPERIMENTAL_DAGGER_CACHE_CONFIG", cacheConfigEnv);

        // Also set standard Dagger cache env vars
        core.exportVariable("DAGGER_CACHE_FROM", `type=local,src=${cacheDir}`);
        core.exportVariable("DAGGER_CACHE_TO", `type=local,dest=${cacheDir},mode=max`);

        logDebug(`Set _EXPERIMENTAL_DAGGER_CACHE_CONFIG=${cacheConfigEnv}`);
        logDebug(`Set DAGGER_CACHE_FROM=type=local,src=${cacheDir}`);
        logDebug(`Set DAGGER_CACHE_TO=type=local,dest=${cacheDir},mode=max`);
    } catch (error) {
        logWarning(`Failed to restore cache: ${error}`);
    }
}

/**
 * Save Dagger build cache to GitHub Actions Cache
 */
export async function saveDaggerCache(): Promise<void> {
    const cacheKey = core.getState(CACHE_STATE_KEY);
    const cachePathsJson = core.getState(CACHE_PATHS_KEY);

    if (!cacheKey || !cachePathsJson) {
        logDebug("No cache state found, skipping save");
        return;
    }

    const cachePaths: string[] = JSON.parse(cachePathsJson);

    logInfo(`Saving Dagger build cache...`);
    logDebug(`Cache key: ${cacheKey}`);

    try {
        await cache.saveCache(cachePaths, cacheKey);
        logInfo("✓ Build cache saved");
    } catch (error) {
        // Cache might already exist or other error
        logWarning(`Failed to save cache: ${error}`);
    }
}

/**
 * Generate cache configuration
 */
export function generateCacheConfig(cacheDir: string): CacheConfig {
    const workflow = process.env.GITHUB_WORKFLOW || "unknown";
    const job = process.env.GITHUB_JOB || "unknown";

    // Primary key includes workflow and job for isolation
    const key = `dagger-build-${workflow}-${job}-${Date.now()}`;

    // Restore keys allow partial matches
    const restoreKeys = [
        `dagger-build-${workflow}-${job}-`,
        `dagger-build-${workflow}-`,
        "dagger-build-",
    ];

    return {
        key,
        paths: [cacheDir],
        restoreKeys,
    };
}

/**
 * Get the cache directory path
 */
export function getCacheDirectory(): string {
    // Use GitHub Actions workspace or temp directory
    const baseDir = process.env.GITHUB_WORKSPACE || os.tmpdir();
    return path.join(baseDir, CACHE_DIR_NAME);
}
