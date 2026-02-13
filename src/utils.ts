import * as core from "@actions/core";
import type { ActionInputs, ActionOutputs } from "./types.js";

/**
 * Parse and validate action inputs
 */
export function parseInputs(): ActionInputs {
    const version = core.getInput("version") || "latest";
    const cacheBuilds = core.getBooleanInput("cache-builds");
    const cacheBinary = core.getBooleanInput("cache-binary");
    const cacheVersion = core.getInput("cache-version") || "v2";
    const cacheTimeoutMinutes = parseInt(core.getInput("cache-timeout-minutes") || "10", 10);

    // Legacy inputs
    const commit = core.getInput("commit");
    const daggerFlags = core.getInput("dagger-flags");
    const verb = core.getInput("verb");
    const workdir = core.getInput("workdir");
    const cloudToken = core.getInput("cloud-token");
    const module = core.getInput("module");
    const args = core.getInput("args");
    const call = core.getInput("call");
    const shell = core.getInput("shell");
    const summaryPath = core.getInput("summary-path");
    const enableGithubSummary = core.getBooleanInput("enable-github-summary");

    return {
        version,
        cacheBuilds,
        cacheBinary,
        cacheVersion,
        cacheTimeoutMinutes,
        commit,
        daggerFlags,
        verb,
        workdir,
        cloudToken,
        module,
        args,
        call,
        shell,
        summaryPath,
        enableGithubSummary,
    };
}

/**
 * Set action outputs
 */
export function setOutputs(outputs: ActionOutputs): void {
    core.setOutput("dagger-version", outputs.daggerVersion);
    core.setOutput("cache-hit", outputs.cacheHit.toString());
    core.setOutput("binary-path", outputs.binaryPath);
    core.setOutput("output", outputs.output);
    core.setOutput("traceURL", outputs.traceURL);
}

/**
 * Log debug information
 */
export function logDebug(message: string): void {
    core.debug(message);
}

/**
 * Log info message
 */
export function logInfo(message: string): void {
    core.info(message);
}

/**
 * Log warning message
 */
export function logWarning(message: string): void {
    core.warning(message);
}

/**
 * Log error message
 */
export function logError(message: string): void {
    core.error(message);
}

/**
 * Wrap a promise with a timeout
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
