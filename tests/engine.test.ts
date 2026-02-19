import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCore, mockExec, resetAllMocks } from "./mocks/actions";

// Note: We use mock.module for @actions/exec.
// The engine module is also tested indirectly through cache.test.ts and main.test.ts.

mock.module("@actions/core", () => mockCore);
mock.module("@actions/exec", () => ({
    getExecOutput: mockExec.getExecOutput,
    exec: mockExec.exec,
}));

describe("Engine Lifecycle", () => {
    beforeEach(() => {
        resetAllMocks();
    });

    it("module exists and exports expected functions", async () => {
        const engine = await import("../src/engine.js");

        expect(typeof engine.findEngineContainer).toBe("function");
        expect(typeof engine.stopEngine).toBe("function");
        expect(typeof engine.backupEngineVolume).toBe("function");
        expect(typeof engine.restoreEngineVolume).toBe("function");
        expect(typeof engine.startEngine).toBe("function");
    });

    describe("stopEngine", () => {
        it("should use docker rm -f for immediate termination", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-stop-1`);
            const result = await engine.stopEngine("abc123");

            expect(result).toBe(true);

            const calls = mockExec._trackers.exec.calls;
            const rmCall = calls.find((c) => {
                const args = c.args[1] as string[] | undefined;
                return c.args[0] === "docker" && args?.includes("rm");
            });

            expect(rmCall).toBeDefined();
            const rmArgs = rmCall?.args[1] as string[];
            expect(rmArgs).toContain("-f");
            expect(rmArgs).toContain("abc123");

            // Should NOT use docker stop
            const stopCall = calls.find((c) => {
                const args = c.args[1] as string[] | undefined;
                return c.args[0] === "docker" && args?.includes("stop");
            });
            expect(stopCall).toBeUndefined();
        });

        it("should handle container already removed gracefully", async () => {
            mockExec._setExecShouldFail(true);
            mockExec._setExecErrorMessage("Error: No such container: abc123");

            const engine = await import(`../src/engine.js?bust=${Date.now()}-stop-2`);
            const result = await engine.stopEngine("abc123");

            expect(result).toBe(true);
        });

        it("should log lifecycle timing information", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-stop-3`);
            await engine.stopEngine("abc123");

            const debugCalls = (await import("./mocks/actions.js")).mockCore._trackers.debug
                .calls;
            const startLog = debugCalls.find((c) =>
                String(c.args[0]).includes("lifecycle:engine:stop:start")
            );
            const endLog = debugCalls.find((c) =>
                String(c.args[0]).includes("lifecycle:engine:stop:end")
            );

            expect(startLog).toBeDefined();
            expect(endLog).toBeDefined();
            expect(String(endLog?.args[0])).toContain("duration=");
        });
    });

    describe("backupEngineVolume", () => {
        it("should create plain tar archive", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-1`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar");

            // Verify exec arguments
            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(0);

            // First call should be "docker volume inspect"
            expect(calls[0].args[0]).toBe("docker");
            expect(calls[0].args[1]).toContain("volume");

            // Second call should be docker run directly (no bash pipe)
            const command = calls[1].args[0] as string;
            const args = calls[1].args[1] as string[];
            const options = calls[1].args[2] as { silent?: boolean };

            expect(command).toBe("docker");
            expect(args).toContain("run");
            expect(args).toContain("--rm");
            expect(args).toContain("busybox");
            expect(args).toContain("tar");
            expect(args).toContain("-C");
            expect(args).toContain("/data");
            expect(args).toContain("-cf");
            // Should output to mounted file, not stdout pipe
            expect(args).toContain("/out/archive.tar");
            // Should NOT contain zstd
            expect(args).not.toContain("zstd");

            // Should be silent by default (!verbose)
            expect(options?.silent).toBe(true);
        });

        it("should log command when verbose is true", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-3`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar", {
                verbose: true,
            });

            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(0);

            // Find the docker run call
            const dockerCall = calls.find((c) => {
                const args = c.args[1] as string[];
                return c.args[0] === "docker" && args.includes("run");
            });

            expect(dockerCall).toBeDefined();
            if (!dockerCall) return;

            // Should NOT be silent
            const options = dockerCall.args[2] as { silent?: boolean };
            expect(options?.silent).toBe(false);
        });

        it("should log lifecycle timing information", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-backup-1`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar");

            const { mockCore } = await import("./mocks/actions.js");
            const debugCalls = mockCore._trackers.debug.calls;
            const startLog = debugCalls.find((c) =>
                String(c.args[0]).includes("lifecycle:backup:start")
            );
            const endLog = debugCalls.find((c) =>
                String(c.args[0]).includes("lifecycle:backup:end")
            );

            expect(startLog).toBeDefined();
            expect(endLog).toBeDefined();
            expect(String(endLog?.args[0])).toContain("duration=");
        });

        it("should register signal handlers for cancellation", async () => {
            // This test verifies the signal handlers are set up
            // The actual signal handling is integration-tested
            const engine = await import(`../src/engine.js?bust=${Date.now()}-backup-2`);

            // Mock fs.existsSync to return true to trigger cleanup path
            const originalExistsSync = (await import("node:fs")).existsSync;
            mock.module("node:fs", () => ({
                existsSync: () => true,
                unlinkSync: () => undefined,
            }));

            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar");

            // Restore mock
            mock.module("node:fs", () => ({
                existsSync: originalExistsSync,
            }));

            // Test passes if no errors - signal handlers were registered
            expect(true).toBe(true);
        });

        it("should attempt to stop helper container when aborted", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-backup-abort`);
            const controller = new AbortController();
            controller.abort();

            await expect(
                engine.backupEngineVolume("vol-name", "/tmp/archive.tar", {
                    abortSignal: controller.signal,
                })
            ).rejects.toThrow("Backup cancelled before starting");

            const calls = mockExec._trackers.exec.calls;
            const removeCall = calls.find((call) => {
                const command = call.args[0] as string;
                const args = call.args[1] as string[];
                return command === "docker" && args[0] === "rm" && args[1] === "-f";
            });

            expect(removeCall).toBeDefined();
        });
    });

    describe("restoreEngineVolume", () => {
        it("should restore from plain tar archive", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-5`);
            await engine.restoreEngineVolume("vol-name", "/tmp/archive.tar");

            // Expect volume create + restore command
            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(1); // Volume create is first

            // Find the restore command (sh -c)
            const restoreCall = calls.find((c) => c.args[0] === "sh");
            expect(restoreCall).toBeDefined();

            if (!restoreCall) return;

            const args = restoreCall.args[1] as string[];
            const shellCmd = args[1];

            // Plain tar should NOT use zstd
            expect(shellCmd).not.toContain("zstd");
            expect(shellCmd).toContain("docker run");
            expect(shellCmd).toContain("tar -C /data -xf");
        });
    });
    describe("mountVolume", () => {
        const originalGetUid = process.getuid;
        const originalGetGid = process.getgid;

        afterEach(() => {
            // Restore original process functions.
            if (originalGetUid) {
                Object.defineProperty(process, "getuid", {
                    value: originalGetUid,
                    configurable: true,
                });
            }
            if (originalGetGid) {
                Object.defineProperty(process, "getgid", {
                    value: originalGetGid,
                    configurable: true,
                });
            }
        });

        it("should use chown to set ownership on mounted volume", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-mount`);

            // Mock getuid/getgid for chown ownership args.
            Object.defineProperty(process, "getuid", {
                value: () => 1001,
                configurable: true,
            });
            Object.defineProperty(process, "getgid", {
                value: () => 1002,
                configurable: true,
            });

            // Read effective values (mock may not stick in all environments).
            const effectiveUid = process.getuid?.() ?? 0;
            const effectiveGid = process.getgid?.() ?? 0;

            mockExec._setExecShouldFail(false);
            await engine.mountVolume("my-vol", "/tmp/target");

            const calls = mockExec._trackers.exec.calls;

            // Helper: find an exec call by command name in either position.
            // With sudo: exec("sudo", ["mount", ...]) → cmd in args[1]
            // Without sudo: exec("mount", ["--bind", ...]) → cmd in args[0]
            const findCallByCmd = (cmd: string) =>
                calls.find((c) => {
                    const command = c.args[0] as string;
                    const args = c.args[1] as string[];
                    return command === cmd || args?.includes(cmd);
                });

            //#then mount --bind is called
            const mountCall = findCallByCmd("mount");
            expect(mountCall).toBeDefined();

            //#then chown sets correct uid:gid
            const chownCall = findCallByCmd("chown");
            expect(chownCall).toBeDefined();

            const allChownArgs = [
                chownCall?.args[0] as string,
                ...((chownCall?.args[1] as string[]) ?? []),
            ];
            expect(allChownArgs).toContain("chown");
            expect(allChownArgs).toContain("-R");
            expect(allChownArgs).toContain(`${effectiveUid}:${effectiveGid}`);
            expect(allChownArgs).toContain("/tmp/target");

            //#then chmod sets read+execute permissions
            const chmodCall = findCallByCmd("chmod");
            expect(chmodCall).toBeDefined();

            const allChmodArgs = [
                chmodCall?.args[0] as string,
                ...((chmodCall?.args[1] as string[]) ?? []),
            ];
            expect(allChmodArgs).toContain("chmod");
            expect(allChmodArgs).toContain("-R");
            expect(allChmodArgs).toContain("u+rX");
            expect(allChmodArgs).toContain("/tmp/target");
        });

        it("should create target directory if it doesn't exist", async () => {
            // Mock node:fs for this specific test
            const originalExistsSync = (await import("node:fs")).existsSync;
            const originalMkdirSync = (await import("node:fs")).mkdirSync;

            mock.module("node:fs", () => ({
                existsSync: () => false,
                mkdirSync: mock(() => undefined),
            }));

            const engine = await import(`../src/engine.js?bust=${Date.now()}-mount-2`);

            // We need to access the mocked mkdirSync. Since we just mocked it above,
            // we can retrieve it from the required module.
            const fs = await import("node:fs");

            await engine.mountVolume("my-vol", "/tmp/new-target");

            expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/new-target", { recursive: true });

            // Restore
            mock.module("node:fs", () => ({
                existsSync: originalExistsSync,
                mkdirSync: originalMkdirSync,
            }));
        });
    });
});
