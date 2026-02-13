import * as core from "@actions/core";

/**
 * Setup Dagger build cache - configure env vars for GitHub Actions Cache
 */
export async function setupDaggerCache(): Promise<void> {
    // Generate a scope based on workflow and job to avoid collisions
    // and allow for some isolation/sharing policy if needed.
    const workflow = process.env.GITHUB_WORKFLOW || "unknown";
    const job = process.env.GITHUB_JOB || "unknown";
    const scope = `dagger-build-${workflow}-${job}`;

    // Set environment variable for Dagger CLI
    // We set both the experimental env var (for older versions) and the standard one
    const cacheConfigEnv = `type=gha,mode=max,scope=${scope}`;
    core.exportVariable("_EXPERIMENTAL_DAGGER_CACHE_CONFIG", cacheConfigEnv);
    process.env["_EXPERIMENTAL_DAGGER_CACHE_CONFIG"] = cacheConfigEnv;

    // Also set standard Dagger cache env vars
    // FROM: strict scope to avoid polling unrelated caches
    core.exportVariable("DAGGER_CACHE_FROM", `type=gha,scope=${scope}`);
    process.env["DAGGER_CACHE_FROM"] = `type=gha,scope=${scope}`;

    // TO: export to the same scope
    core.exportVariable("DAGGER_CACHE_TO", `type=gha,mode=max,scope=${scope}`);
    process.env["DAGGER_CACHE_TO"] = `type=gha,mode=max,scope=${scope}`;

    core.debug(`Set _EXPERIMENTAL_DAGGER_CACHE_CONFIG=${cacheConfigEnv}`);
    core.debug(`Set DAGGER_CACHE_FROM=type=gha,scope=${scope}`);
    core.debug(`Set DAGGER_CACHE_TO=type=gha,mode=max,scope=${scope}`);
    core.info(`Configured Dagger cache with scope: ${scope}`);
}

/**
 * Save Dagger build cache to GitHub Actions Cache
 * No-op for type=gha as Dagger handles this natively.
 * Kept for signature compatibility with main.ts
 */
export async function saveDaggerCache(): Promise<void> {
    core.debug("Dagger cache saving is handled natively by type=gha, skipping manual save.");
}
