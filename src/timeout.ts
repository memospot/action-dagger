/**
 * Wrap a promise with a timeout.
 */
export async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(
                () => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)),
                timeoutMs
            )
        ),
    ]);
}

/**
 * Wrap a promise with timeout and interruption callback.
 */
export async function withInterruptibleTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string,
    onTimeout: () => Promise<void> | void
): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            void Promise.resolve(onTimeout()).catch(() => {
                // Best effort: interruption callback errors should not mask timeout.
            });
            reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
