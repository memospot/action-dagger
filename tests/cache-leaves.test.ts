import { beforeEach, describe, expect, it, mock } from "bun:test";

import {
    attemptContainerRestore,
    attemptContainerSave,
    attemptDirectRestore,
    attemptDirectSave,
    determineRestoreStrategy,
    hasEnoughDiskSpace,
    shouldSkipSave,
} from "../src/cache";

// Mocks
const mockCore = {
    info: mock(),
    warning: mock(),
    debug: mock(),
    saveState: mock(),
    getState: mock(),
    exportVariable: mock(),
    setFailed: mock(),
    error: mock(),
    isDebug: mock(() => false),
};

const mockCache = {
    saveCache: mock(),
    restoreCache: mock(),
};

const mockExec = {
    exec: mock(),
};

const mockEngine = {
    mountVolume: mock(),
    unmountVolume: mock(),
    findEngineContainer: mock(),
    stopEngine: mock(),
    getVolumeSize: mock(),
    deleteEngineVolume: mock(),
    backupEngineVolume: mock(),
    restoreEngineVolume: mock(),
    startEngine: mock(),
};

// Mock disk-space using module mocking
mock.module("../src/disk-space", () => ({
    getAvailableDiskSpace: mock(() => Promise.resolve(10 * 1024 * 1024 * 1024)), // 10GB
}));

// Mock everything else
mock.module("@actions/core", () => mockCore);
mock.module("@actions/cache", () => mockCache);
mock.module("@actions/exec", () => mockExec);
mock.module("../src/engine", () => mockEngine);
mock.module("node:fs", () => ({
    existsSync: mock(() => false),
    statSync: mock(() => ({ isDirectory: () => false })),
    rmSync: mock(),
    unlinkSync: mock(),
    mkdirSync: mock(),
}));

describe("Cache Leaf Helpers", () => {
    const cacheDir = "/tmp/dagger-engine-state";
    const cacheKey = "dagger-linux-amd64-123";
    const restoreKeys = ["dagger-linux-amd64-"];

    beforeEach(() => {
        mockCore.info.mockClear();
        mockCore.warning.mockClear();
        mockCache.saveCache.mockClear();
        mockCache.restoreCache.mockClear();
        mockEngine.mountVolume.mockClear();
        mockEngine.unmountVolume.mockClear();
        mockEngine.backupEngineVolume.mockClear();
        mockEngine.restoreEngineVolume.mockClear();
    });

    describe("shouldSkipSave", () => {
        it("should return true if restoredKey matches keyToSave", () => {
            expect(shouldSkipSave("key1", "key1")).toBe(true);
        });

        it("should return false if keys differ", () => {
            expect(shouldSkipSave("key1", "key2")).toBe(false);
        });

        it("should return false if restoredKey is undefined", () => {
            expect(shouldSkipSave(undefined as unknown as string, "key2")).toBe(false);
        });
    });

    describe("hasEnoughDiskSpace", () => {
        it("should return true if space is sufficient", async () => {
            mockEngine.getVolumeSize.mockResolvedValue(1 * 1024 * 1024 * 1024); // 1GB
            const result = await hasEnoughDiskSpace("/tmp");
            expect(result).toBe(true);
        });

        // Note: Can't easily mock module return value change within same test file unless we use spyOn on the import if possible,
        // but bun test module mocking is static. We set 10GB default.
        // So we can test the "volume size too big" case?
        // If available is 10GB. Min required is 3GB.
        // If volume size is ignored in check?
        // Logic: if (availableSpace > 0 && availableSpace < MIN_REQUIRED_SPACE)
        // It doesn't use volumeSize in the logic, just logs it.
    });

    describe("determineRestoreStrategy", () => {
        it("should enable direct and container for auto", () => {
            expect(determineRestoreStrategy("auto")).toEqual({
                tryDirect: true,
                tryContainer: true,
            });
        });

        it("should enable only direct for direct", () => {
            expect(determineRestoreStrategy("direct")).toEqual({
                tryDirect: true,
                tryContainer: false,
            });
        });

        it("should enable only container for container", () => {
            expect(determineRestoreStrategy("container")).toEqual({
                tryDirect: false,
                tryContainer: true,
            });
        });
    });

    describe("attemptDirectSave", () => {
        it("should mount volume, save cache, and unmount", async () => {
            mockEngine.mountVolume.mockResolvedValue(undefined);
            mockCache.saveCache.mockResolvedValue(12345);
            mockEngine.unmountVolume.mockResolvedValue(undefined);

            const result = await attemptDirectSave(cacheKey, 10, cacheDir);

            expect(mockEngine.mountVolume).toHaveBeenCalledWith("dagger-engine-vol", cacheDir);
            expect(mockCache.saveCache).toHaveBeenCalled();
            expect(mockEngine.unmountVolume).toHaveBeenCalledWith(cacheDir);
            expect(result).toBe(true);
        });

        it("should return false on error and still unmount", async () => {
            mockEngine.mountVolume.mockResolvedValue(undefined);
            mockCache.saveCache.mockRejectedValue(new Error("Save failed"));
            mockEngine.unmountVolume.mockResolvedValue(undefined);

            const result = await attemptDirectSave(cacheKey, 10, cacheDir);

            expect(mockCore.warning).toHaveBeenCalled();
            expect(mockEngine.unmountVolume).toHaveBeenCalledWith(cacheDir);
            expect(result).toBe(false);
        });
    });

    describe("attemptContainerSave", () => {
        it("should backup volume and save cache", async () => {
            mockEngine.backupEngineVolume.mockResolvedValue(undefined);
            mockCache.saveCache.mockResolvedValue(12345);

            const result = await attemptContainerSave(cacheKey, 10, cacheDir);

            expect(mockEngine.backupEngineVolume).toHaveBeenCalled();
            expect(mockCache.saveCache).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it("should return false on error", async () => {
            mockEngine.backupEngineVolume.mockRejectedValue(new Error("Backup failed"));

            const result = await attemptContainerSave(cacheKey, 10, cacheDir);

            expect(mockCore.warning).toHaveBeenCalled();
            expect(result).toBe(false);
        });
    });

    describe("attemptDirectRestore", () => {
        it("should mount, restore, and return key on success", async () => {
            mockEngine.mountVolume.mockResolvedValue(undefined);
            mockCache.restoreCache.mockResolvedValue(cacheKey);
            mockEngine.unmountVolume.mockResolvedValue(undefined);

            const result = await attemptDirectRestore(cacheKey, restoreKeys, cacheDir);

            expect(mockEngine.mountVolume).toHaveBeenCalled();
            expect(mockCache.restoreCache).toHaveBeenCalled();
            expect(mockEngine.unmountVolume).toHaveBeenCalled();
            expect(result).toBe(cacheKey);
        });

        it("should return undefined on cache miss", async () => {
            mockEngine.mountVolume.mockResolvedValue(undefined);
            mockCache.restoreCache.mockResolvedValue(undefined);
            mockEngine.unmountVolume.mockResolvedValue(undefined);

            const result = await attemptDirectRestore(cacheKey, restoreKeys, cacheDir);

            expect(result).toBeUndefined();
        });

        it("should throw on error", async () => {
            mockEngine.mountVolume.mockResolvedValue(undefined);
            mockCache.restoreCache.mockRejectedValue(new Error("Restore error"));
            mockEngine.unmountVolume.mockResolvedValue(undefined);

            expect(attemptDirectRestore(cacheKey, restoreKeys, cacheDir)).rejects.toThrow();
            expect(mockEngine.unmountVolume).toHaveBeenCalled();
        });
    });

    describe("attemptContainerRestore", () => {
        it("should restore cache and restore volume on success", async () => {
            mockCache.restoreCache.mockResolvedValue(cacheKey);
            // Mock fs.existsSync to return true for archive
            mock.module("node:fs", () => ({
                existsSync: mock(() => true), // archive exists
                statSync: mock(() => ({ isDirectory: () => false })),
                rmSync: mock(),
                unlinkSync: mock(),
                mkdirSync: mock(),
            }));
            mockEngine.restoreEngineVolume.mockResolvedValue(undefined);

            const result = await attemptContainerRestore(cacheKey, restoreKeys, cacheDir);

            expect(mockCache.restoreCache).toHaveBeenCalled();
            expect(mockEngine.restoreEngineVolume).toHaveBeenCalled();
            expect(result).toBe(cacheKey);
        });

        it("should return undefined on cache miss", async () => {
            mockCache.restoreCache.mockResolvedValue(undefined);
            const result = await attemptContainerRestore(cacheKey, restoreKeys, cacheDir);
            expect(result).toBeUndefined();
        });
    });
});
