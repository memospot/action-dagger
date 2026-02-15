import * as core from "@actions/core";
import { saveDaggerCache } from "./cache";
import { parseInputs } from "./parse-inputs";

/**
 * Post-action cleanup - saves Dagger build cache
 */
export async function postAction(): Promise<void> {
    try {
        core.info("💾 Running post-action: Saving Dagger build cache");
        core.info(`STATE_isPost env var: ${process.env.STATE_isPost || "not set"}`);

        const inputs = parseInputs();
        core.info(`cache-builds input: ${inputs.cacheBuilds}`);

        if (inputs.cacheBuilds) {
            core.info("Build cache is enabled, proceeding to save…");

            // Get resolved cache key and compression level from state
            const cacheKey = core.getState("CACHE_KEY") || inputs.cacheKey;
            const compressionLevelStr = core.getState("CACHE_COMPRESSION");
            const compressionLevel =
                compressionLevelStr !== ""
                    ? parseInt(compressionLevelStr, 10)
                    : inputs.cacheCompression;

            await saveDaggerCache(cacheKey, inputs.cacheTimeoutMinutes, compressionLevel);
            core.info("✅ Dagger build cache save completed");
        } else {
            core.info("Build cache disabled, skipping save");
        }
    } catch (error) {
        core.warning(
            `Failed to save cache: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
