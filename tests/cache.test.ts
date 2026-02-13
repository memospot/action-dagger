import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCache, mockCore, resetAllMocks } from "./mocks/actions.js";

// ---------------------------------------------------------------------------
// Module mocks — must be registered before importing the module under test.
// ---------------------------------------------------------------------------

mock.module("@actions/cache", () => mockCache);
mock.module("@actions/core", () => mockCore);

// Mock the engine module
const mockEngine = {
    findEngineContainer: mock(() => Promise.resolve("mock-container-id")),
    stopEngine: mock(() => Promise.resolve(true)),
    backupEngineVolume: mock(() => Promise.resolve()),
    restoreEngineVolume: mock(() => Promise.resolve()),
    startEngine: mock(() => Promise.resolve()),
};

mock.module("../src/engine.js", () => mockEngine);

// Mock node:fs to control existsSync
const mockFs = {
    existsSync: mock(() => false),
    statSync: mock(() => ({ size: 1024 })),
    mkdirSync: mock(() => undefined),
    rmSync: mock(() => undefined),
    writeFileSync: mock(() => undefined),
};

// We need to spread the original fs to keep other methods working if needed,
// but for cache.ts we mostly need these.
mock.module("node:fs", () => ({
    ...require("node:fs"),
    ...mockFs,
}));

// Import the module under test AFTER mocks are registered.
import { saveDaggerCache, setupDaggerCache } from "../src/cache.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cache", () => {
    beforeEach(() => {
        resetAllMocks();
        mockEngine.findEngineContainer.mockClear();
        mockEngine.stopEngine.mockClear();
        mockEngine.backupEngineVolume.mockClear();
        mockEngine.restoreEngineVolume.mockClear();
        mockEngine.startEngine.mockClear();

        mockFs.existsSync.mockClear();
        mockFs.statSync.mockClear();

        // Default fs behavior
        mockFs.existsSync.mockReturnValue(false);
    });

    afterEach(() => {
        delete process.env.GITHUB_WORKFLOW;
        delete process.env.GITHUB_REPOSITORY;
        delete process.env.RUNNER_TEMP;
    });

    // -----------------------------------------------------------------------
    // setupDaggerCache
    // -----------------------------------------------------------------------
    describe("setupDaggerCache", () => {
        it("should restore cache and hydrate engine volume", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            // Mock successful cache restore
            mockCache._setRestoreResult("dagger-cache-key");

            await setupDaggerCache("v0.15.0");

            // Should call restoreCache
            expect(mockCache._trackers.restoreCache.calls).toHaveLength(1);

            // Should call engine restore
            expect(mockEngine.restoreEngineVolume).toHaveBeenCalled();

            // Should start engine
            expect(mockEngine.startEngine).toHaveBeenCalled();

            // Should export runner host
            const exportedVars = mockCore._trackers.exportVariable.calls.map((c) => c.args[0]);
            expect(exportedVars).toContain("_EXPERIMENTAL_DAGGER_RUNNER_HOST");
        });

        it("should start fresh engine if cache restore returns null", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            // Mock cache miss
            mockCache._setRestoreResult(undefined);

            await setupDaggerCache("v0.15.0");

            // Should call restoreCache
            expect(mockCache._trackers.restoreCache.calls).toHaveLength(1);

            // Should NOT call engine restore
            expect(mockEngine.restoreEngineVolume).not.toHaveBeenCalled();

            // Should still start engine
            expect(mockEngine.startEngine).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // saveDaggerCache
    // -----------------------------------------------------------------------
    describe("saveDaggerCache", () => {
        it("should backup engine volume and save cache", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            // Mock engine exists
            mockEngine.findEngineContainer.mockResolvedValue("test-container-id");

            // Mock archive file creation success checks
            mockFs.existsSync.mockReturnValue(true);

            await saveDaggerCache("v0.15.0");

            // Should find engine
            expect(mockEngine.findEngineContainer).toHaveBeenCalled();

            // Should stop engine
            expect(mockEngine.stopEngine).toHaveBeenCalledWith("test-container-id");

            // Should backup volume
            expect(mockEngine.backupEngineVolume).toHaveBeenCalled();

            // Should save to cache
            expect(mockCache._trackers.saveCache.calls).toHaveLength(1);
        });

        it("should not save cache if no engine container found", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            // Mock no engine
            mockEngine.findEngineContainer.mockResolvedValue(null as unknown as string);

            await saveDaggerCache("v0.15.0");

            // Should verify find called
            expect(mockEngine.findEngineContainer).toHaveBeenCalled();

            // Should NOT stop or backup
            expect(mockEngine.stopEngine).not.toHaveBeenCalled();
            expect(mockEngine.backupEngineVolume).not.toHaveBeenCalled();

            // Should NOT save cache
            expect(mockCache._trackers.saveCache.calls).toHaveLength(0);
        });
    });
});
