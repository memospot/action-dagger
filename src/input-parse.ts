import * as core from "@actions/core";
/**
 * Action input configuration
 */
export interface ActionInputs {
    /** Dagger CLI version to install */
    version: string;
    /** Enable Dagger build cache persistence */
    cacheBuilds: boolean;
    /** Cache Dagger binary to avoid re-downloading */
    cacheBinary: boolean;
    /** Custom cache key for build cache. If not provided, a default key is generated. */
    cacheKey?: string;
    /** Timeout in minutes for cache operations */
    cacheTimeoutMinutes: number;
    /** Cache mode: auto (default), direct, or container */
    cacheMode: "auto" | "direct" | "container";
    commit: string;
    daggerFlags: string;
    verb: string;
    workdir: string;
    cloudToken: string;
    module: string;
    args: string;
    call: string;
    shell: string;
    summaryPath: string;
    enableGithubSummary: boolean;
}

/**
 * Parse and validate action inputs.
 */
export function parseInputs(): ActionInputs {
    const version = core.getInput("version") || "latest";
    const cacheBuilds = core.getBooleanInput("cache-builds");
    const cacheBinary = core.getBooleanInput("cache-binary");
    const cacheKey = core.getInput("cache-key");
    const cacheTimeoutMinutes = parseInt(core.getInput("cache-timeout") || "10", 10);
    const cacheModeInput = core.getInput("cache-mode") || "auto";
    const validCacheModes = ["auto", "direct", "container"] as const;
    let cacheMode: (typeof validCacheModes)[number];
    if (validCacheModes.includes(cacheModeInput as (typeof validCacheModes)[number])) {
        cacheMode = cacheModeInput as (typeof validCacheModes)[number];
    } else {
        core.warning(`Invalid cache-mode '${cacheModeInput}', using 'auto'`);
        cacheMode = "auto";
    }

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
        cacheMode,
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
