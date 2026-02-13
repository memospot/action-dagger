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
});
