import * as core from "@actions/core";
import { saveDaggerCache } from "./cache";
import { parseInputs } from "./input-parse";

/**
 * Post-action cleanup - saves Dagger build cache
 */
export async function postAction(): Promise<void> {
    try {
        if (process.platform !== "linux") {
            // Silence the warning for post-action if run on non-linux (it shouldn't run anyway), but we should exit gracefully
            return;
        }

        core.info("💾 Running post-action: Saving Dagger build cache");
        core.info(`STATE_isPost env var: ${process.env.STATE_isPost || "not set"}`);

        const inputs = parseInputs();
        core.info(`cache-builds input: ${inputs.cacheBuilds}`);

        // Get resolved cache key and cache mode from state
        const cacheKey = core.getState("CACHE_KEY") || inputs.cacheKey;
        const cacheModeState = core.getState("CACHE_MODE");
        const cacheMode: "auto" | "direct" | "container" =
            cacheModeState === "direct" ||
            cacheModeState === "container" ||
            cacheModeState === "auto"
                ? cacheModeState
                : inputs.cacheMode;

        await saveDaggerCache(
            inputs.cacheBuilds,
            cacheKey,
            inputs.cacheTimeoutMinutes,
            cacheMode
        );
        core.info("✅ Dagger build cache save completed");
    } catch (error) {
        core.warning(
            `Failed to save cache: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
