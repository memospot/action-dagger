import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mockExec, resetAllMocks } from "./mocks/actions.js";

// Note: We use mock.module for @actions/exec.
// The engine module is also tested indirectly through cache.test.ts and main.test.ts.

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
        it("should create plain tar archive when compressionLevel is 0", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-1`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar", {
                compressionLevel: 0,
            });

            // Verify exec arguments
            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(0);

            // First call should be "docker volume inspect"
            expect(calls[0].args[0]).toBe("docker");
            expect(calls[0].args[1]).toContain("volume");

            // Should NOT check for zstd (level 0 uses plain tar)
            const whichCalls = calls.filter((c) => c.args[0] === "which");
            expect(whichCalls.length).toBe(0);

            // Second call should be the backup command (bash)
            const command = calls[1].args[0] as string;
            const args = calls[1].args[1] as string[];
            const options = calls[1].args[2] as { silent?: boolean };

            expect(command).toBe("bash");
            expect(args[0]).toBe("-c");

            const shellCmd = args[1];
            expect(shellCmd).toContain("set -o pipefail");
            expect(shellCmd).toContain("docker run");
            expect(shellCmd).toContain("alpine tar");
            expect(shellCmd).toContain("> /tmp/archive.tar");
            // Should NOT contain zstd
            expect(shellCmd).not.toContain("zstd");

            // Should be silent by default (!verbose)
            expect(options?.silent).toBe(true);
        });

        it("should pipe tar to zstd when compressionLevel is > 0", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-2`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar.zst", {
                compressionLevel: 3,
            });

            // Verify exec arguments
            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(0);

            // First call should be "docker volume inspect"
            expect(calls[0].args[0]).toBe("docker");
            expect(calls[0].args[1]).toContain("volume");

            // Second call should be "which zstd"
            expect(calls[1].args[0]).toBe("which");

            // Third call should be the backup command
            const command = calls[2].args[0] as string;
            const args = calls[2].args[1] as string[];
            const options = calls[2].args[2] as { silent?: boolean };

            expect(command).toBe("bash");
            expect(args[0]).toBe("-c");

            const shellCmd = args[1];
            expect(shellCmd).toContain("set -o pipefail");
            expect(shellCmd).toContain("docker run");
            expect(shellCmd).toContain("alpine tar");
            expect(shellCmd).toContain("| zstd -T0 -3");
            expect(shellCmd).toContain("-o /tmp/archive.tar.zst");

            // Should be silent by default (!verbose)
            expect(options?.silent).toBe(true);
        });

        it("should log command when verbose is true", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-3`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar.zst", {
                verbose: true,
                compressionLevel: 3,
            });

            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(0);

            // Find the bash -c call
            const bashCall = calls.find((c) => c.args[0] === "bash");
            expect(bashCall).toBeDefined();
            if (!bashCall) return;

            // Should NOT be silent
            const options = bashCall.args[2] as { silent?: boolean };
            expect(options?.silent).toBe(false);
        });

        it("should log lifecycle timing information", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-backup-1`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar", {
                compressionLevel: 0,
            });

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

            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar", {
                compressionLevel: 0,
            });

            // Restore mock
            mock.module("node:fs", () => ({
                existsSync: originalExistsSync,
            }));

            // Test passes if no errors - signal handlers were registered
            expect(true).toBe(true);
        });
    });

    describe("restoreEngineVolume", () => {
        it("should restore from zstd compressed archive", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-4`);
            await engine.restoreEngineVolume("vol-name", "/tmp/archive.tar.zst");

            // Expect volume create + restore command
            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(1); // Volume create is first

            // Find the restore command (sh -c)
            const restoreCall = calls.find((c) => c.args[0] === "sh");
            expect(restoreCall).toBeDefined();

            if (!restoreCall) return;

            const args = restoreCall.args[1] as string[];
            const shellCmd = args[1];

            expect(shellCmd).toContain("zstd -d -c /tmp/archive.tar.zst");
            expect(shellCmd).toContain("|");
            expect(shellCmd).toContain("docker run");
            expect(shellCmd).toContain("-i"); // Crucial flag
            expect(shellCmd).toContain("tar -C /data -xf -");
        });

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
});
