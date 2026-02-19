import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
    adjustVolumePermissions,
    cleanupBackupArchive,
    constructBackupArgs,
    mountBind,
    setupBackupAbortHandler,
    setupBackupSignalHandlers,
    verifyVolumeExists,
} from "../src/engine";

// Mocks
const mockCore = {
    info: mock(),
    warning: mock(),
    debug: mock(),
    error: mock(),
};

const mockExec = {
    exec: mock(),
};

const mockDocker = {
    shouldUseSudo: mock(() => false),
};

const mockExistsSync = mock(() => false);
const mockUnlinkSync = mock();
const mockMkdirSync = mock();
const mockStatSync = mock(() => ({ isDirectory: () => false }));

mock.module("@actions/core", () => mockCore);
mock.module("@actions/exec", () => mockExec);
mock.module("../src/docker", () => mockDocker);
mock.module("node:fs", () => ({
    existsSync: mockExistsSync,
    unlinkSync: mockUnlinkSync,
    mkdirSync: mockMkdirSync,
    statSync: mockStatSync,
}));

describe("Engine Leaf Helpers", () => {
    beforeEach(() => {
        mockCore.debug.mockClear();
        mockExec.exec.mockClear();
        mockExec.exec.mockResolvedValue(0); // Default success
        mockDocker.shouldUseSudo.mockClear();
        mockDocker.shouldUseSudo.mockReturnValue(false); // Default false
        mockExistsSync.mockClear();
        mockUnlinkSync.mockClear();
    });

    describe("verifyVolumeExists", () => {
        it("should verify volume exists via docker inspect", async () => {
            await verifyVolumeExists("my-vol");
            expect(mockExec.exec).toHaveBeenCalledWith(
                "docker",
                ["volume", "inspect", "my-vol"],
                { silent: true }
            );
        });

        it("should throw if volume does not exist", async () => {
            mockExec.exec.mockRejectedValueOnce(new Error("No such volume"));
            expect(verifyVolumeExists("missing-vol")).rejects.toThrow(
                "Volume missing-vol does not exist"
            );
        });
    });

    describe("constructBackupArgs", () => {
        it("should construct correct arguments for backup", () => {
            const args = constructBackupArgs(
                "my-vol",
                "/tmp/backup/archive.tar",
                "backup-helper"
            );
            expect(args).toContain("run");
            expect(args).toContain("--name");
            expect(args).toContain("backup-helper");
            expect(args).toContain("--rm");
            expect(args).toContain("my-vol:/data:ro");
            expect(args).toContain("/tmp/backup:/out");
            expect(args).toContain("/out/archive.tar");
        });
    });

    describe("cleanupBackupArchive", () => {
        it("should unlink file if it exists", () => {
            mockExistsSync.mockReturnValue(true);

            cleanupBackupArchive("/tmp/archive.tar");
            expect(mockUnlinkSync).toHaveBeenCalledWith("/tmp/archive.tar");
            expect(mockCore.debug).toHaveBeenCalledWith(
                expect.stringContaining("partialArchiveRemoved=true")
            );
        });

        it("should do nothing if file does not exist", () => {
            mockExistsSync.mockReturnValue(false);

            cleanupBackupArchive("/tmp/archive.tar");
            expect(mockUnlinkSync).not.toHaveBeenCalled();
        });
    });

    describe("setupBackupSignalHandlers", () => {
        it("should register signal handlers and return cleanup function", () => {
            const onceSpy = spyOn(process, "once");
            const offSpy = spyOn(process, "off");

            // Mock implementation to avoid actual signal listener removal issues if needed
            onceSpy.mockImplementation(() => process);
            offSpy.mockImplementation(() => process);

            const onCancel = mock();
            const cleanup = setupBackupSignalHandlers(onCancel);

            expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
            expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

            cleanup();

            expect(offSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
            expect(offSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

            onceSpy.mockRestore();
            offSpy.mockRestore();
        });
    });

    describe("setupBackupAbortHandler", () => {
        it("should register and cleanup abort listener", () => {
            const controller = new AbortController();
            const onCancel = mock();

            const cleanup = setupBackupAbortHandler(controller.signal, onCancel);
            controller.abort();

            expect(onCancel).toHaveBeenCalledTimes(1);
            cleanup();
        });
    });

    describe("mountBind", () => {
        it("should use mount --bind without sudo when not required", async () => {
            mockDocker.shouldUseSudo.mockReturnValue(false);
            await mountBind("/source", "/target", false);
            expect(mockExec.exec).toHaveBeenCalledWith(
                "mount",
                ["--bind", "/source", "/target"],
                { silent: true }
            );
        });

        it("should use sudo mount --bind when required", async () => {
            mockDocker.shouldUseSudo.mockReturnValue(true);
            await mountBind("/source", "/target", true);
            expect(mockExec.exec).toHaveBeenCalledWith(
                "sudo",
                ["mount", "--bind", "/source", "/target"],
                { silent: true }
            );
        });
    });

    describe("adjustVolumePermissions", () => {
        it("should chown and chmod with sudo when required", async () => {
            mockDocker.shouldUseSudo.mockReturnValue(true);
            await adjustVolumePermissions("/target", true);
            // Cannot easily verify exact calls without more complex call tracking due to multiple exec calls
            // But we can verify it called exec with sudo
            expect(mockExec.exec).toHaveBeenCalledWith(
                "sudo",
                expect.arrayContaining(["chown", "-R"]),
                { silent: true }
            );
            expect(mockExec.exec).toHaveBeenCalledWith(
                "sudo",
                expect.arrayContaining(["chmod", "-R"]),
                { silent: true }
            );
        });

        it("should chown and chmod without sudo", async () => {
            mockDocker.shouldUseSudo.mockReturnValue(false);
            await adjustVolumePermissions("/target", false);
            expect(mockExec.exec).toHaveBeenCalledWith(
                "chown",
                expect.arrayContaining(["-R"]),
                { silent: true }
            );
            expect(mockExec.exec).toHaveBeenCalledWith(
                "chmod",
                expect.arrayContaining(["-R"]),
                { silent: true }
            );
        });
    });
});
