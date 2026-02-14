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

    describe("backupEngineVolume", () => {
        it("should pipe tar to zstd", async () => {
            // Bypass mock/cache by appending query param

            const engine = await import(`../src/engine.js?bust=${Date.now()}-1`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar.zst");

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
            const engine = await import(`../src/engine.js?bust=${Date.now()}-2`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar.zst", {
                verbose: true,
            });

            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(0);

            // Find the bash -c call (third call)
            const bashCall = calls.find((c) => c.args[0] === "bash");
            expect(bashCall).toBeDefined();
            if (!bashCall) return;

            // Should NOT be silent
            const options = bashCall.args[2] as { silent?: boolean };
            expect(options?.silent).toBe(false);
        });
    });

    describe("restoreEngineVolume", () => {
        it("should pipe zstd to tar", async () => {
            const engine = await import(`../src/engine.js?bust=${Date.now()}-3`);
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
    });
});
