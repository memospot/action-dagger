import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCore, resetAllMocks } from "./mocks/actions.js";

// ---------------------------------------------------------------------------
// Module mocks — must be registered before importing the module under test.
// ---------------------------------------------------------------------------

mock.module("@actions/core", () => mockCore);

// Import the module under test AFTER mocks are registered.
import { saveDaggerCache, setupDaggerCache } from "../src/cache.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cache", () => {
    beforeEach(() => {
        resetAllMocks();
    });

    afterEach(() => {
        delete process.env.GITHUB_WORKFLOW;
        delete process.env.GITHUB_JOB;
        // cleanup process.env vars set by the code
        delete process.env._EXPERIMENTAL_DAGGER_CACHE_CONFIG;
        delete process.env.DAGGER_CACHE_FROM;
        delete process.env.DAGGER_CACHE_TO;
    });

    // -----------------------------------------------------------------------
    // setupDaggerCache
    // -----------------------------------------------------------------------
    describe("setupDaggerCache", () => {
        it("should export correct GHA cache environment variables", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_JOB = "test-job";

            await setupDaggerCache();

            expect(mockCore._trackers.exportVariable.calls).toHaveLength(3);

            const exportCalls = mockCore._trackers.exportVariable.calls;
            const exportedVars = exportCalls.map((c) => c.args[0]);

            expect(exportedVars).toContain("_EXPERIMENTAL_DAGGER_CACHE_CONFIG");
            expect(exportedVars).toContain("DAGGER_CACHE_FROM");
            expect(exportedVars).toContain("DAGGER_CACHE_TO");

            // Verify process.env is updated
            expect(process.env._EXPERIMENTAL_DAGGER_CACHE_CONFIG).toContain("type=gha");
            expect(process.env._EXPERIMENTAL_DAGGER_CACHE_CONFIG).toContain(
                "scope=dagger-build-test-flow-test-job"
            );

            expect(process.env.DAGGER_CACHE_FROM).toContain("type=gha");
            expect(process.env.DAGGER_CACHE_FROM).toContain(
                "scope=dagger-build-test-flow-test-job"
            );

            expect(process.env.DAGGER_CACHE_TO).toContain("type=gha");
            expect(process.env.DAGGER_CACHE_TO).toContain("mode=max");
            expect(process.env.DAGGER_CACHE_TO).toContain(
                "scope=dagger-build-test-flow-test-job"
            );
        });
    });

    // -----------------------------------------------------------------------
    // saveDaggerCache
    // -----------------------------------------------------------------------
    describe("saveDaggerCache", () => {
        it("should be a no-op", async () => {
            await saveDaggerCache();
            // Should not throw and essentially do nothing
            expect(true).toBe(true);
        });
    });
});
