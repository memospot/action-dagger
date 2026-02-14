import * as core from "@actions/core";

/**
 * Log debug information.
 */
export function logDebug(message: string): void {
    core.debug(message);
}

/**
 * Log info message.
 */
export function logInfo(message: string): void {
    core.info(message);
}

/**
 * Log warning message.
 */
export function logWarning(message: string): void {
    core.warning(message);
}

/**
 * Log error message.
 */
export function logError(message: string): void {
    core.error(message);
}
