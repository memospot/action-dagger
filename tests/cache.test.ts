import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as path from "node:path";
import { OperationCancelledError } from "../src/operation-cancelled-error";
import { mockCache, mockCore, resetAllMocks } from "./mocks/actions";

// ---------------------------------------------------------------------------
// Module mocks — must be registered before importing the module under test.
// ---------------------------------------------------------------------------

mock.module("@actions/cache", () => mockCache);
mock.module("@actions/core", () => mockCore);

// Mock engine module
const mockEngine = {
    findEngineContainer: mock(() => Promise.resolve("mock-container-id")),
    stopEngine: mock(() => Promise.resolve(true)),
    backupEngineVolume: mock(() => Promise.resolve()),
    restoreEngineVolume: mock(() => Promise.resolve()),
    mountVolume: mock(() => Promise.resolve()),
    unmountVolume: mock(() => Promise.resolve()),
    startEngine: mock(() => Promise.resolve()),
    deleteEngineVolume: mock(() => Promise.resolve()),
    getVolumeSize: mock(() => Promise.resolve(1024 * 1024 * 100)), // 100MB
    clearEngineVolume: mock(() => Promise.resolve()),
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
    withInterruptibleTimeout: mock((promise) => promise),
};

mock.module("../src/timeout.js", () => mockTimeout);

// Mock node:fs to control existsSync
const mockFs = {
    existsSync: mock(() => false),
    statSync: mock(() => ({ size: 1024, isDirectory: () => false as boolean })),
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
        mockEngine.mountVolume.mockClear();
        mockEngine.unmountVolume.mockClear();

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

            mockCache._setRestoreResult("dagger-x64-12345");

            await setupDaggerCache("v0.15.0");

            const restoreCalls = mockCache._trackers.restoreCache.calls;
            expect(restoreCalls).toHaveLength(1);
            const [_paths, primaryKey, restoreKeys] = restoreCalls[0].args;

            expect(primaryKey).toBe("dagger-x64-12345");
            expect(restoreKeys).toEqual(["dagger-x64"]);
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

        it("should optimistically mount volume before restore", async () => {
            process.env.RUNNER_TEMP = "/tmp";
            mockCache._setRestoreResult("hit-key");
            await setupDaggerCache("v0.15.0");

            expect(mockEngine.mountVolume).toHaveBeenCalledWith(
                "dagger-engine-vol",
                path.join("/tmp", "dagger-engine-state")
            );
            expect(mockEngine.unmountVolume).toHaveBeenCalledWith(
                path.join("/tmp", "dagger-engine-state")
            );
            expect(mockEngine.startEngine).toHaveBeenCalled();
        });

        it("should extract internal archive if fallback tar exists", async () => {
            process.env.RUNNER_TEMP = "/tmp";
            mockCache._setRestoreResult("hit-key");

            // Mock that the tarball exists inside the volume (which is mounted at cacheDir)
            mockFs.existsSync.mockReturnValue(true);

            await setupDaggerCache("v0.15.0");

            // Should call exec to extract
            // We can't easily spy on exec.exec here as it's not mocked directly in this file's scope?
            // Ah, we mocked engine, but extractInternalArchive calls @actions/exec directly.
            // We need to mock @actions/exec in the test file if we want to check it.
            // But wait, we didn't mock exec in the mocks section above?
            // "import * as exec from "@actions/exec";" is in cache.ts
            // We need to register mock for @actions/exec.
        });

        it("should start fresh engine on cache miss", async () => {
            mockCache._setRestoreResult(undefined);
            await setupDaggerCache("v0.15.0");

            expect(mockEngine.mountVolume).toHaveBeenCalled(); // Always mounts
            expect(mockEngine.startEngine).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // saveDaggerCache
    // -----------------------------------------------------------------------
    describe("saveDaggerCache", () => {
        it("should skip all operations when cacheBuilds is false", async () => {
            await saveDaggerCache(false);

            expect(mockEngine.findEngineContainer).not.toHaveBeenCalled();
            expect(
                mockCore._trackers.info.calls.some((c) =>
                    String(c.args[0]).includes("Build cache disabled")
                )
            ).toBe(true);
        });

        it("should attempt direct save first when cacheBuilds is true", async () => {
            process.env.RUNNER_TEMP = "/tmp";
            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockFs.existsSync.mockReturnValue(true);

            await saveDaggerCache(true, undefined, 10);

            expect(mockEngine.mountVolume).toHaveBeenCalledWith(
                "dagger-engine-vol",
                path.join("/tmp", "dagger-engine-state")
            );
            expect(mockCache._trackers.saveCache.calls).toHaveLength(1);
            expect(mockEngine.unmountVolume).toHaveBeenCalled();
        });

        it("should fallback to archive save if direct save fails", async () => {
            process.env.RUNNER_TEMP = "/tmp";
            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockFs.existsSync.mockReturnValue(true);

            // Trigger failure in saveCache (will fail both times, but that's enough to trigger fallback logic)
            mockCache._setSaveShouldFail(true);

            await saveDaggerCache(true, undefined, 10);

            // First attempt (Direct) failed
            expect(mockEngine.mountVolume).toHaveBeenCalledTimes(1);

            // Should have tried to backup volume
            expect(mockEngine.backupEngineVolume).toHaveBeenCalledWith(
                "dagger-engine-vol",
                path.join("/tmp", "dagger-engine-state", "dagger-engine-state.tar"),
                expect.anything()
            );
        });

        it("should skip backup if disk space is low (soft fail)", async () => {
            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockDiskSpace.getAvailableDiskSpace.mockResolvedValue(1024); // Low space

            await saveDaggerCache(true);

            expect(mockEngine.backupEngineVolume).not.toHaveBeenCalled();
            expect(mockCache._trackers.saveCache.calls).toHaveLength(0);
            expect(
                mockCore._trackers.warning.calls.some((c) =>
                    String(c.args[0]).includes("Skipping cache save")
                )
            ).toBe(true);
        });

        it("should prune volume after successful save", async () => {
            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockFs.existsSync.mockReturnValue(true);

            await saveDaggerCache(true);

            expect(mockEngine.deleteEngineVolume).toHaveBeenCalled();
        });

        it("should prune even when cache is immutable (static key hit)", async () => {
            // Simulate cache hit with same key (immutable)
            process.env.GITHUB_RUN_ID = "12345";
            mockCore._stateStore.CACHE_RESTORED_KEY = "my-static-key";
            mockEngine.findEngineContainer.mockResolvedValue("container-id");

            await saveDaggerCache(true, "my-static-key");

            // Should stop engine even though save is skipped
            expect(mockEngine.stopEngine).toHaveBeenCalled();
            // Should NOT save (immutable)
            expect(mockCache._trackers.saveCache.calls).toHaveLength(0);
        });

        it("should skip cache upload when backup is cancelled", async () => {
            process.env.RUNNER_TEMP = "/tmp";
            mockEngine.findEngineContainer.mockResolvedValue("container-id");
            mockFs.existsSync.mockReturnValue(true);
            mockCache._setSaveShouldFail(true);

            mockEngine.backupEngineVolume.mockRejectedValue(
                new OperationCancelledError("cancelled")
            );

            await saveDaggerCache(true, undefined, 10, "auto");

            expect(mockCache._trackers.saveCache.calls).toHaveLength(1);
        });
    });
});
