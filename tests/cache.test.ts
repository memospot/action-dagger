import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCore, resetAllMocks } from "./mocks/actions.js";

// ---------------------------------------------------------------------------
// Module mocks — must be registered before importing the module under test.
// ---------------------------------------------------------------------------

const mockCacheRestore = mock(() => Promise.resolve(undefined));
const mockCacheSave = mock(() => Promise.resolve(1));

mock.module("@actions/cache", () => ({
    restoreCache: mockCacheRestore,
    saveCache: mockCacheSave,
}));

mock.module("@actions/core", () => mockCore);

// Import the module under test AFTER mocks are registered.
import { saveDaggerCache, setupDaggerCache } from "../src/cache.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cache", () => {
    beforeEach(() => {
        resetAllMocks();
        mockCacheRestore.mockClear();
        mockCacheSave.mockClear();
    });

    afterEach(() => {
        delete process.env.GITHUB_WORKFLOW;
        delete process.env.GITHUB_JOB;
        delete process.env.GITHUB_REPOSITORY;
        delete process.env.RUNNER_TEMP;
        // cleanup process.env vars set by the code
        delete process.env._EXPERIMENTAL_DAGGER_CACHE_CONFIG;
        delete process.env.DAGGER_CACHE_FROM;
        delete process.env.DAGGER_CACHE_TO;
    });

    // -----------------------------------------------------------------------
    // setupDaggerCache
    // -----------------------------------------------------------------------
    describe("setupDaggerCache", () => {
        it("should attempt to restore cache and export local cache env vars", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            mockCacheRestore.mockImplementation(() =>
                Promise.resolve("dagger-build-test-org/test-repo-test-flow")
            );

            await setupDaggerCache();

            // Should call restoreCache
            expect(mockCacheRestore.mock.calls.length).toBe(1);
            const restoreCall = mockCacheRestore.mock.calls[0];
            expect(restoreCall[0][0]).toContain("dagger-build-cache");
            expect(restoreCall[1]).toBe("dagger-build-test-org/test-repo-test-flow");

            // Should export 3 environment variables
            expect(mockCore._trackers.exportVariable.calls).toHaveLength(3);

            const exportCalls = mockCore._trackers.exportVariable.calls;
            const exportedVars = exportCalls.map((c) => c.args[0]);

            expect(exportedVars).toContain("_EXPERIMENTAL_DAGGER_CACHE_CONFIG");
            expect(exportedVars).toContain("DAGGER_CACHE_FROM");
            expect(exportedVars).toContain("DAGGER_CACHE_TO");

            // Verify process.env is updated with type=local instead of type=gha
            expect(process.env.DAGGER_CACHE_FROM).toContain("type=local");
            expect(process.env.DAGGER_CACHE_FROM).toContain("src=");

            expect(process.env.DAGGER_CACHE_TO).toContain("type=local");
            expect(process.env.DAGGER_CACHE_TO).toContain("dest=");
            expect(process.env.DAGGER_CACHE_TO).toContain("mode=max");
        });

        it("should handle cache restore failure gracefully", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            mockCacheRestore.mockImplementation(() => Promise.reject(new Error("Cache error")));

            // Should not throw
            await setupDaggerCache();

            // Should still configure env vars even if restore fails
            expect(process.env.DAGGER_CACHE_FROM).toContain("type=local");
        });
    });

    // -----------------------------------------------------------------------
    // saveDaggerCache
    // -----------------------------------------------------------------------
    describe("saveDaggerCache", () => {
        it("should save cache if directory has content", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            // Create mock cache directory with content
            const fs = await import("node:fs");
            const cacheDir = "/tmp/dagger-build-cache";
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(`${cacheDir}/test.txt`, "test content");

            await saveDaggerCache();

            expect(mockCacheSave.mock.calls.length).toBe(1);

            // Cleanup
            fs.rmSync(cacheDir, { recursive: true, force: true });
        });

        it("should handle already existing cache gracefully", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            // Create mock cache directory with content
            const fs = await import("node:fs");
            const cacheDir = "/tmp/dagger-build-cache";
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(`${cacheDir}/test.txt`, "test content");

            mockCacheSave.mockImplementation(() => {
                throw new Error("Cache entry already exists");
            });

            // Should not throw
            await saveDaggerCache();

            // Cleanup
            fs.rmSync(cacheDir, { recursive: true, force: true });
        });
    });
});
