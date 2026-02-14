import * as core from "@actions/core";
import type { ActionInputs } from "./types";

/**
 * Parse and validate action inputs.
 */
export function parseInputs(): ActionInputs {
    const version = core.getInput("version") || "latest";
    const cacheBuilds = core.getBooleanInput("cache-builds");
    const cacheBinary = core.getBooleanInput("cache-binary");
    const cacheKey = core.getInput("cache-key");
    const cacheTimeoutMinutes = parseInt(core.getInput("cache-timeout-minutes") || "10", 10);
    const cacheCompressionRaw = parseInt(core.getInput("cache-compression") || "0", 10);
    const cacheCompression = Math.max(0, Math.min(19, cacheCompressionRaw));
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
        cacheKey,
        cacheTimeoutMinutes,
        cacheCompression,
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
