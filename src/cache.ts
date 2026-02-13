import * as core from "@actions/core";

/**
 * Setup Dagger build cache - configure env vars for GitHub Actions Cache
 */
export async function setupDaggerCache(): Promise<void> {
    // Generate a scope based on workflow name and repository
    // Using a consistent scope allows cache sharing across runs
    const workflow = process.env.GITHUB_WORKFLOW || "unknown";
    const repository = process.env.GITHUB_REPOSITORY || "unknown";
    // Use a stable scope - not including job name to allow sharing across job instances
    const scope = `dagger-${repository}-${workflow}`;

    // Check for required GitHub Actions cache env vars
    // These are needed for the type=gha cache backend to work
    const hasCacheUrl = !!process.env.ACTIONS_CACHE_URL;
    const hasRuntimeToken = !!process.env.ACTIONS_RUNTIME_TOKEN;

    if (!hasCacheUrl || !hasRuntimeToken) {
        core.warning(
            `GitHub Actions cache env vars missing. ` +
                `ACTIONS_CACHE_URL: ${hasCacheUrl ? "set" : "missing"}, ` +
                `ACTIONS_RUNTIME_TOKEN: ${hasRuntimeToken ? "set" : "missing"}. ` +
                `Build cache may not work properly.`
        );
    } else {
        core.debug(`ACTIONS_CACHE_URL is set`);
        core.debug(`ACTIONS_RUNTIME_TOKEN is set`);
    }

    // Set environment variable for Dagger CLI
    // We set both the experimental env var (for older versions) and the standard one
    const cacheConfigEnv = `type=gha,mode=max,scope=${scope}`;
    core.exportVariable("_EXPERIMENTAL_DAGGER_CACHE_CONFIG", cacheConfigEnv);
    process.env["_EXPERIMENTAL_DAGGER_CACHE_CONFIG"] = cacheConfigEnv;

    // Also set standard Dagger cache env vars
    // FROM: use the same scope to read from where we wrote
    core.exportVariable("DAGGER_CACHE_FROM", `type=gha,scope=${scope}`);
    process.env["DAGGER_CACHE_FROM"] = `type=gha,scope=${scope}`;

    // TO: export to the same scope
    core.exportVariable("DAGGER_CACHE_TO", `type=gha,mode=max,scope=${scope}`);
    process.env["DAGGER_CACHE_TO"] = `type=gha,mode=max,scope=${scope}`;

    core.info(`Configured Dagger build cache:`);
    core.info(`  Scope: ${scope}`);
    core.info(`  From: type=gha,scope=${scope}`);
    core.info(`  To: type=gha,mode=max,scope=${scope}`);
}

/**
 * Save Dagger build cache to GitHub Actions Cache
 * No-op for type=gha as Dagger handles this natively.
 * Kept for signature compatibility with main.ts
 */
export async function saveDaggerCache(): Promise<void> {
    core.debug("Dagger cache saving is handled natively by type=gha, skipping manual save.");
}
