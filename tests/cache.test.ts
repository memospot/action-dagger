import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCache, mockCore, resetAllMocks } from "./mocks/actions.js";

// ---------------------------------------------------------------------------
// Module mocks — must be registered before importing the module under test.
// ---------------------------------------------------------------------------

mock.module("@actions/core", () => mockCore);
mock.module("@actions/cache", () => mockCache);

// Import the module under test AFTER mocks are registered.
import {
    generateCacheConfig,
    getCacheDirectory,
    saveDaggerCache,
    setupDaggerCache,
} from "../src/cache.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cache", () => {
    beforeEach(() => {
        resetAllMocks();
    });

    afterEach(() => {
        delete process.env.GITHUB_WORKSPACE;
        delete process.env.GITHUB_WORKFLOW;
        delete process.env.GITHUB_JOB;
    });

    // -----------------------------------------------------------------------
    // generateCacheConfig
    // -----------------------------------------------------------------------
    describe("generateCacheConfig", () => {
        it("should generate cache configuration with correct structure", () => {
            const cacheDir = "/tmp/test-cache";
            const config = generateCacheConfig(cacheDir);

            expect(config).toHaveProperty("key");
            expect(config).toHaveProperty("paths");
            expect(config).toHaveProperty("restoreKeys");

            expect(config.paths).toContain(cacheDir);
            expect(config.key).toMatch(/^dagger-build-/);
            expect(Array.isArray(config.restoreKeys)).toBe(true);
            expect(config.restoreKeys.length).toBeGreaterThan(0);
        });

        it("should generate unique keys for different runs", () => {
            const cacheDir = "/tmp/test-cache";
            const config1 = generateCacheConfig(cacheDir);

            const start = Date.now();
            while (Date.now() - start < 10) {}

            const config2 = generateCacheConfig(cacheDir);

            expect(config1.key).not.toBe(config2.key);
            expect(config1.restoreKeys).toEqual(config2.restoreKeys);
        });

        it("should include workflow and job in cache key", () => {
            process.env.GITHUB_WORKFLOW = "test-workflow";
            process.env.GITHUB_JOB = "test-job";

            const config = generateCacheConfig("/tmp/test-cache");

            expect(config.key).toContain("test-workflow");
            expect(config.key).toContain("test-job");
            expect(config.restoreKeys[0]).toContain("test-workflow");
            expect(config.restoreKeys[0]).toContain("test-job");
        });

        it("should fall back to 'unknown' when env vars are missing", () => {
            delete process.env.GITHUB_WORKFLOW;
            delete process.env.GITHUB_JOB;

            const config = generateCacheConfig("/tmp/test-cache");

            expect(config.key).toContain("unknown");
        });
    });

    // -----------------------------------------------------------------------
    // getCacheDirectory
    // -----------------------------------------------------------------------
    describe("getCacheDirectory", () => {
        it("should return a path within the workspace", () => {
            process.env.GITHUB_WORKSPACE = "/github/workspace";

            const cacheDir = getCacheDirectory();

            expect(cacheDir).toContain("/github/workspace");
            expect(cacheDir).toContain(".dagger-cache");
        });

        it("should fallback to tmpdir when GITHUB_WORKSPACE is not set", () => {
            delete process.env.GITHUB_WORKSPACE;

            const cacheDir = getCacheDirectory();

            expect(typeof cacheDir).toBe("string");
            expect(cacheDir.length).toBeGreaterThan(0);
            expect(cacheDir).toContain(".dagger-cache");
        });
    });

    // -----------------------------------------------------------------------
    // setupDaggerCache
    // -----------------------------------------------------------------------
    describe("setupDaggerCache", () => {
        it("should attempt to restore cache and save state on cache miss", async () => {
            process.env.GITHUB_WORKSPACE = "/tmp/test-workspace";
            mockCache._setRestoreResult(undefined); // miss

            await setupDaggerCache();

            expect(mockCache._trackers.restoreCache.calls).toHaveLength(1);

            expect(mockCore._trackers.saveState.calls).toHaveLength(2);
            expect(mockCore._trackers.saveState.calls[0].args[0]).toBe("DAGGER_CACHE_KEY");
            expect(mockCore._trackers.saveState.calls[1].args[0]).toBe("DAGGER_CACHE_PATHS");

            expect(mockCore._trackers.exportVariable.calls).toHaveLength(3);

            // Check for _EXPERIMENTAL_DAGGER_CACHE_CONFIG
            const exportCalls = mockCore._trackers.exportVariable.calls;
            const exportedVars = exportCalls.map((c) => c.args[0]);

            expect(exportedVars).toContain("_EXPERIMENTAL_DAGGER_CACHE_CONFIG");
            expect(exportedVars).toContain("DAGGER_CACHE_FROM");
            expect(exportedVars).toContain("DAGGER_CACHE_TO");

            // Verify process.env is also updated (crucial for current process usage)
            expect(process.env._EXPERIMENTAL_DAGGER_CACHE_CONFIG).toBeDefined();
            expect(process.env.DAGGER_CACHE_FROM).toBeDefined();
            expect(process.env.DAGGER_CACHE_TO).toBeDefined();
        });

        it("should log hit message when cache is restored", async () => {
            process.env.GITHUB_WORKSPACE = "/tmp/test-workspace";
            mockCache._setRestoreResult("dagger-build-my-key-123");

            await setupDaggerCache();

            const infoMessages = mockCore._trackers.info.calls.map((c) => c.args[0] as string);
            expect(infoMessages.some((msg) => msg.includes("Restored build cache"))).toBe(true);
        });

        it("should handle restoreCache errors gracefully", async () => {
            process.env.GITHUB_WORKSPACE = "/tmp/test-workspace";

            // Use the error flag instead of reassigning the function
            mockCache._setRestoreShouldFail(true);

            // Should NOT throw
            await setupDaggerCache();

            // Should have logged a warning
            expect(mockCore._trackers.warning.calls.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // saveDaggerCache
    // -----------------------------------------------------------------------
    describe("saveDaggerCache", () => {
        it("should save cache when state is present", async () => {
            mockCore._stateStore.DAGGER_CACHE_KEY = "dagger-build-test-key";
            mockCore._stateStore.DAGGER_CACHE_PATHS = JSON.stringify(["/tmp/cache-dir"]);

            await saveDaggerCache();

            expect(mockCache._trackers.saveCache.calls).toHaveLength(1);
            const [paths, key] = mockCache._trackers.saveCache.calls[0].args as [
                string[],
                string,
            ];
            expect(paths).toEqual(["/tmp/cache-dir"]);
            expect(key).toBe("dagger-build-test-key");
        });

        it("should skip save when no state is found", async () => {
            await saveDaggerCache();

            expect(mockCache._trackers.saveCache.calls).toHaveLength(0);
        });

        it("should handle save errors gracefully", async () => {
            mockCore._stateStore.DAGGER_CACHE_KEY = "dagger-build-test-key";
            mockCore._stateStore.DAGGER_CACHE_PATHS = JSON.stringify(["/tmp/cache-dir"]);

            // Use the error flag instead of reassigning the function
            mockCache._setSaveShouldFail(true);

            // Should NOT throw
            await saveDaggerCache();

            expect(mockCore._trackers.warning.calls.length).toBeGreaterThan(0);
        });

        it("should handle malformed cache paths JSON gracefully", async () => {
            mockCore._stateStore.DAGGER_CACHE_KEY = "dagger-build-test-key";
            mockCore._stateStore.DAGGER_CACHE_PATHS = "not-valid-json";

            // Should throw when parsing invalid JSON
            await expect(saveDaggerCache()).rejects.toThrow();
        });
    });
});
