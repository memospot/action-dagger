import * as fs from "node:fs";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";

const CACHE_DIR_NAME = "dagger-build-cache";

/**
 * Get the cache directory path
 */
function getCacheDir(): string {
    const tempDir = process.env.RUNNER_TEMP || "/tmp";
    return path.join(tempDir, CACHE_DIR_NAME);
}

/**
 * Generate cache key based on repository and workflow
 */
function getCacheKey(): string {
    const workflow = process.env.GITHUB_WORKFLOW || "unknown";
    const repository = process.env.GITHUB_REPOSITORY || "unknown";
    return `dagger-build-${repository}-${workflow}`;
}

/**
 * Setup Dagger build cache - restore from GitHub Actions Cache and configure Dagger
 */
export async function setupDaggerCache(): Promise<void> {
    const cacheDir = getCacheDir();
    const cacheKey = getCacheKey();
    const restoreKeys = [
        `dagger-build-${process.env.GITHUB_REPOSITORY || "unknown"}-`,
        "dagger-build-",
    ];

    // Ensure cache directory exists
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        core.info(`Created cache directory: ${cacheDir}`);
    }

    core.info(`Attempting to restore build cache with key: ${cacheKey}`);

    try {
        const restoredKey = await cache.restoreCache([cacheDir], cacheKey, restoreKeys);

        if (restoredKey) {
            core.info(`✓ Restored build cache from key: ${restoredKey}`);

            // Log cache size for debugging
            const stats = getDirectorySize(cacheDir);
            core.info(`  Cache size: ${formatBytes(stats.size)} (${stats.files} files)`);
        } else {
            core.info("No build cache found, starting fresh");
        }
    } catch (error) {
        core.warning(`Failed to restore cache: ${error}`);
    }

    // Configure Dagger to use local cache directory
    // Using type=local instead of type=gha for reliable caching
    const cacheFrom = `type=local,src=${cacheDir}`;
    const cacheTo = `type=local,dest=${cacheDir},mode=max`;

    core.exportVariable("DAGGER_CACHE_FROM", cacheFrom);
    process.env.DAGGER_CACHE_FROM = cacheFrom;

    core.exportVariable("DAGGER_CACHE_TO", cacheTo);
    process.env.DAGGER_CACHE_TO = cacheTo;

    // Also set legacy env var for older Dagger versions
    core.exportVariable("_EXPERIMENTAL_DAGGER_CACHE_CONFIG", cacheTo);
    process.env._EXPERIMENTAL_DAGGER_CACHE_CONFIG = cacheTo;

    core.info(`Configured Dagger build cache:`);
    core.info(`  Directory: ${cacheDir}`);
    core.info(`  From: ${cacheFrom}`);
    core.info(`  To: ${cacheTo}`);
}

/**
 * Save Dagger build cache to GitHub Actions Cache
 */
export async function saveDaggerCache(): Promise<void> {
    const cacheDir = getCacheDir();
    const cacheKey = getCacheKey();

    if (!fs.existsSync(cacheDir)) {
        core.info("Cache directory does not exist, nothing to save");
        return;
    }

    // Check if directory has content
    const stats = getDirectorySize(cacheDir);
    if (stats.files === 0) {
        core.info("Cache directory is empty, nothing to save");
        return;
    }

    core.info(
        `Saving build cache (${formatBytes(stats.size)}, ${stats.files} files) with key: ${cacheKey}`
    );

    try {
        await cache.saveCache([cacheDir], cacheKey);
        core.info(`✓ Saved build cache successfully`);
    } catch (error) {
        // Cache might already exist (race condition), which is fine
        if (error instanceof Error && error.message.includes("already exists")) {
            core.info("Cache entry already exists (this is normal)");
        } else {
            core.warning(`Failed to save cache: ${error}`);
        }
    }
}

/**
 * Get directory size and file count
 */
function getDirectorySize(dir: string): { size: number; files: number } {
    let size = 0;
    let files = 0;

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const subStats = getDirectorySize(fullPath);
                size += subStats.size;
                files += subStats.files;
            } else {
                size += fs.statSync(fullPath).size;
                files++;
            }
        }
    } catch {
        // Directory might not exist or be readable
    }

    return { size, files };
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}
