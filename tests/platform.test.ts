import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCache, mockCore, mockExec, mockToolCache, resetAllMocks } from "./mocks/actions";

// Mock everything before imports
mock.module("@actions/core", () => mockCore);
mock.module("@actions/cache", () => mockCache);
mock.module("@actions/tool-cache", () => mockToolCache);
mock.module("@actions/exec", () => ({
    getExecOutput: mockExec.getExecOutput,
    exec: mockExec.exec,
}));

// We need to import the functions AFTER mocking the modules
// But bun tests run immediately on import, making mocking tricky for top-level code?
// No, imports are hoisted but modulemocks are applied.
// The issue is process.platform is global.

describe("Platform Constraints", () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        resetAllMocks();
    });

    afterEach(() => {
        Object.defineProperty(process, "platform", {
            value: originalPlatform,
        });
    });

    it("runAction should fail on non-linux platform", async () => {
        // Mock platform being 'darwin'
        Object.defineProperty(process, "platform", {
            value: "darwin",
        });

        // Dynamic import to pick up the platform change?
        // No, process.platform is read at runtime inside the function.
        const { runAction } = await import("../src/action-run.js");

        await runAction();

        expect(mockCore._trackers.setFailed.calls).toHaveLength(1);
        const msg = mockCore._trackers.setFailed.calls[0].args[0] as string;
        expect(msg).toContain("only supports Linux runners");
    });

    it("postAction should skip on non-linux platform", async () => {
        // Mock platform being 'win32'
        Object.defineProperty(process, "platform", {
            value: "win32",
        });

        const { postAction } = await import("../src/action-post.js");

        await postAction();

        // postAction just returns silently on non-linux, doesn't setFailed
        // It's safer for cleanup phases not to fail the build if environment is weird
        expect(mockCore._trackers.setFailed.calls).toHaveLength(0);
    });
});
