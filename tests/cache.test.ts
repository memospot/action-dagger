import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCache, mockCore, resetAllMocks } from "./mocks/actions";

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
    deleteEngineVolume: mock(() => Promise.resolve()),
};

mock.module("../src/engine.js", () => mockEngine);

// Mock disk-space module
const mockDiskSpace = {
    getAvailableDiskSpace: mock(() => Promise.resolve(10 * 1024 * 1024 * 1024)), // 10GB default
};

mock.module("../src/disk-space.js", () => mockDiskSpace);

// Mock timeout module
const mockTimeout = {
    withTimeout: mock((promise) => promise), // Pass through by default
};

mock.module("../src/timeout.js", () => mockTimeout);

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
        mockEngine.deleteEngineVolume.mockClear();

        mockDiskSpace.getAvailableDiskSpace.mockClear();
        mockDiskSpace.getAvailableDiskSpace.mockResolvedValue(10 * 1024 * 1024 * 1024); // Reset to 10GB

        mockFs.existsSync.mockClear();
        mockFs.statSync.mockClear();

        // Default fs behavior
        mockFs.existsSync.mockReturnValue(false);
    });

    afterEach(() => {
        delete process.env.GITHUB_WORKFLOW;
        delete process.env.GITHUB_REPOSITORY;
        delete process.env.GITHUB_RUN_ID;
        delete process.env.RUNNER_TEMP;
    });

    // -----------------------------------------------------------------------
    // setupDaggerCache
    // -----------------------------------------------------------------------
    describe("setupDaggerCache", () => {
        it("should use default keys when no custom key provided", async () => {
            process.env.GITHUB_RUN_ID = "12345";
            process.env.RUNNER_TEMP = "/tmp";
            // Mock platform/arch
            Object.defineProperty(process, "platform", { value: "linux" });
            Object.defineProperty(process, "arch", { value: "x64" });

            mockCache._setRestoreResult("dagger-v1-linux-x64-12345");

            await setupDaggerCache("v0.15.0");

            const restoreCalls = mockCache._trackers.restoreCache.calls;
            expect(restoreCalls).toHaveLength(1);
            const [_paths, primaryKey, restoreKeys] = restoreCalls[0].args;

            expect(primaryKey).toBe("dagger-v1-linux-x64-12345");
            expect(restoreKeys).toEqual(["dagger-v1-linux-x64"]);
        });

        it("should use custom key when provided", async () => {
            process.env.RUNNER_TEMP = "/tmp";

            mockCache._setRestoreResult("my-key");

            await setupDaggerCache("v0.15.0", "my-key-run1");

            const restoreCalls = mockCache._trackers.restoreCache.calls;
            const [_paths, primaryKey, restoreKeys] = restoreCalls[0].args;

            expect(primaryKey).toBe("my-key-run1");
            expect(restoreKeys).toEqual(["my-key"]);
        });

        it("should restore engine volume on cache hit", async () => {
            mockCache._setRestoreResult("hit-key");
            await setupDaggerCache("v0.15.0");

            expect(mockEngine.restoreEngineVolume).toHaveBeenCalled();
            expect(mockEngine.startEngine).toHaveBeenCalled();
        });

        it("should start fresh engine on cache miss", async () => {
            mockCache._setRestoreResult(undefined);
            await setupDaggerCache("v0.15.0");

            expect(mockEngine.restoreEngineVolume).not.toHaveBeenCalled();
            expect(mockEngine.startEngine).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // saveDaggerCache
    // -----------------------------------------------------------------------
    describe("saveDaggerCache", () => {
        it("should save with default key when no custom key provided", async () => {
            process.env.GITHUB_RUN_ID = "999";
            // Mock platform/arch
            Object.defineProperty(process, "platform", { value: "linux" });
            Object.defineProperty(process, "arch", { value: "x64" });

            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockFs.existsSync.mockReturnValue(true);

            await saveDaggerCache(undefined);

            const saveCalls = mockCache._trackers.saveCache.calls;
            expect(saveCalls).toHaveLength(1);
            const [_paths, key] = saveCalls[0].args;

            expect(key).toBe("dagger-v1-linux-x64-999");
        });

        it("should save with custom key when provided", async () => {
            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockFs.existsSync.mockReturnValue(true);

            await saveDaggerCache("custom-key-123");

            const saveCalls = mockCache._trackers.saveCache.calls;
            const [_paths, key] = saveCalls[0].args;

            expect(key).toBe("custom-key-123");
        });

        it("should skip backup if disk space is low (soft fail)", async () => {
            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockDiskSpace.getAvailableDiskSpace.mockResolvedValue(1024); // Low space

            await saveDaggerCache();

            expect(mockEngine.backupEngineVolume).not.toHaveBeenCalled();
            expect(mockCache._trackers.saveCache.calls).toHaveLength(0);
            expect(
                mockCore._trackers.info.calls.some((c) =>
                    String(c.args[0]).includes("Soft Fail")
                )
            ).toBe(true);
        });

        it("should prune volume after successful save", async () => {
            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockFs.existsSync.mockReturnValue(true);

            await saveDaggerCache();

            expect(mockEngine.deleteEngineVolume).toHaveBeenCalled();
        });
    });
});
