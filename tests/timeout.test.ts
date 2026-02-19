import { describe, expect, it, mock } from "bun:test";

describe("withTimeout", () => {
    it("should resolve when operation finishes before timeout", async () => {
        const { withTimeout } = await import(
            `../src/timeout.ts?bust=${Date.now()}-with-timeout-ok`
        );
        const result = await withTimeout(Promise.resolve("ok"), 50, "test operation");

        expect(result).toBe("ok");
    });

    it("should reject when operation exceeds timeout", async () => {
        const { withTimeout } = await import(
            `../src/timeout.ts?bust=${Date.now()}-with-timeout-timeout`
        );
        const neverResolves = new Promise<string>(() => undefined);

        await expect(withTimeout(neverResolves, 10, "test timeout")).rejects.toThrow(
            "test timeout timed out"
        );
    });

    it("should clear timeout when operation resolves", async () => {
        const { withTimeout } = await import(
            `../src/timeout.ts?bust=${Date.now()}-with-timeout-clear`
        );

        const originalClearTimeout = globalThis.clearTimeout;
        const clearTimeoutSpy = mock((handle: NodeJS.Timeout | number) =>
            originalClearTimeout(handle)
        );
        globalThis.clearTimeout = clearTimeoutSpy as typeof globalThis.clearTimeout;

        try {
            await withTimeout(Promise.resolve("ok"), 1000, "test clear");
        } finally {
            globalThis.clearTimeout = originalClearTimeout;
        }

        expect(clearTimeoutSpy).toHaveBeenCalled();
    });
});

describe("withInterruptibleTimeout", () => {
    it("should resolve when operation finishes before timeout", async () => {
        const { withInterruptibleTimeout } = await import(
            `../src/timeout.ts?bust=${Date.now()}-resolve`
        );
        const onTimeout = mock(() => undefined);
        const result = await withInterruptibleTimeout(
            Promise.resolve("ok"),
            50,
            "test operation",
            onTimeout
        );

        expect(result).toBe("ok");
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it("should trigger interruption callback on timeout", async () => {
        const { withInterruptibleTimeout } = await import(
            `../src/timeout.ts?bust=${Date.now()}-timeout`
        );
        const onTimeout = mock(() => undefined);
        const neverResolves = new Promise<string>(() => undefined);

        await expect(
            withInterruptibleTimeout(neverResolves, 10, "test timeout", onTimeout)
        ).rejects.toThrow("test timeout timed out");

        expect(onTimeout).toHaveBeenCalledTimes(1);
    });
});
