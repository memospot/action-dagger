import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mockExec, resetAllMocks } from "./mocks/actions.js";

/**
 * NOTE: Bun's mock.module() doesn't work for transitive imports.
 * Since engine.ts imports @actions/exec, and we can't reliably mock
 * that import, these tests would require dependency injection or
 * a different test runner to work properly.
 *
 * The engine module is tested indirectly through cache.test.ts
 * and main.test.ts which mock the entire engine module.
 */

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
        it("should use normal tar command by default", async () => {
            // Bypass mock/cache by appending query param
            // @ts-expect-error
            const engine = await import(`../src/engine.js?bust=${Date.now()}-1`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar");

            // Verify exec was called with correct arguments
            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(0);

            const args = calls[0].args[1] as string[];
            const options = calls[0].args[2] as { silent?: boolean };

            // Should contain "cf" (create file) but NOT "v" (verbose)
            expect(args).toContain("cf");
            expect(args).not.toContain("cvf");

            // Should be silent by default (!verbose)
            expect(options?.silent).toBe(true);
        });

        it("should use verbose tar command when verbose option is true", async () => {
            // @ts-expect-error
            const engine = await import(`../src/engine.js?bust=${Date.now()}-2`);
            await engine.backupEngineVolume("vol-name", "/tmp/archive.tar", { verbose: true });

            // Verify exec was called with correct arguments
            const calls = mockExec._trackers.exec.calls;
            expect(calls.length).toBeGreaterThan(0);

            const args = calls[0].args[1] as string[];
            const options = calls[0].args[2] as { silent?: boolean };

            // Should contain "cvf" (create verbose file) and "--totals"
            expect(args).toContain("cvf");
            expect(args).toContain("--totals");

            // Should NOT be silent
            expect(options?.silent).toBe(false);
        });
    });
});
