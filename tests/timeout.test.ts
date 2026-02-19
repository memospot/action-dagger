import { describe, expect, it, mock } from "bun:test";

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
