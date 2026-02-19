import { describe, expect, it } from "bun:test";
import {
    isOperationCancelledError,
    OperationCancelledError,
} from "../src/operation-cancelled-error";

describe("operation-cancelled-error", () => {
    it("should identify OperationCancelledError instances", () => {
        const error = new OperationCancelledError("cancelled");

        expect(isOperationCancelledError(error)).toBe(true);
    });

    it("should reject non-cancellation errors", () => {
        const error = new Error("other");

        expect(isOperationCancelledError(error)).toBe(false);
    });
});
