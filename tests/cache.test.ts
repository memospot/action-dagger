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

            // Should backup volume with verbose option
            expect(mockEngine.backupEngineVolume).toHaveBeenCalled();

            // Should save to cache
            expect(mockCache._trackers.saveCache.calls).toHaveLength(1);
        });

        it("should log archive size after backup", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            mockEngine.findEngineContainer.mockResolvedValue("test-container-id");
            mockFs.existsSync.mockReturnValue(true);
            mockFs.statSync.mockReturnValue({ size: 1024 * 1024 * 256 }); // 256 MB

            await saveDaggerCache("v0.15.0");

            // Should log archive size
            const infoCalls = mockCore._trackers.info.calls.map((c) => String(c.args[0]));
            expect(infoCalls.some((msg) => msg.includes("📊 Archive size:"))).toBe(true);
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

        it("should soft-fail and continue on timeout", async () => {
            process.env.GITHUB_WORKFLOW = "test-flow";
            process.env.GITHUB_REPOSITORY = "test-org/test-repo";
            process.env.RUNNER_TEMP = "/tmp";

            mockEngine.findEngineContainer.mockResolvedValue("test-container-id");
            mockFs.existsSync.mockReturnValue(true);

            // Mock backup to take longer than timeout
            // We use a small timeout for the test (e.g. 1ms), so 50ms delay is enough
            mockEngine.backupEngineVolume.mockImplementation(async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
            });

            // Call with very short timeout: 0.00002 mins ~ 1.2ms
            // But withTimeout has min 1ms granularity?
            // Let's use a slightly larger timeout and larger delay to be safe and avoid flakes.
            // 0.001 min = 60ms. Delay 150ms.
            const timeoutMinutes = 0.0005; // 30ms

            await saveDaggerCache("v0.15.0", "v2", timeoutMinutes);

            // Should warn about timeout
            const warningCalls = mockCore._trackers.warning.calls.map((c) => String(c.args[0]));
            expect(warningCalls.some((msg) => msg.includes("timed out"))).toBe(true);

            // Should info about continuing
            const infoCalls = mockCore._trackers.info.calls.map((c) => String(c.args[0]));
            expect(infoCalls.some((msg) => msg.includes("Continuing without cache save"))).toBe(
                true
            );

            // Should NOT save cache (because backup didn't complete / was skipped)
            expect(mockCache._trackers.saveCache.calls).toHaveLength(0);
        });
    });
});
