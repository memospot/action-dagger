/**
 * Error used to signal intentional operation cancellation.
 */
export class OperationCancelledError extends Error {
    public readonly isOperationCancelled = true;

    public constructor(message: string) {
        super(message);
        this.name = "OperationCancelledError";
    }
}

/**
 * Type guard for operation cancellation errors.
 */
export function isOperationCancelledError(error: unknown): error is OperationCancelledError {
    if (!(error instanceof Error)) {
        return false;
    }

    return error.name === "OperationCancelledError";
}
