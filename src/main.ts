import * as core from "@actions/core";
import { saveDaggerCache, setupDaggerCache } from "./cache.js";
import { getBinary } from "./dagger.js";
import { executeDaggerCommand, writeSummary } from "./exec.js";
import type { ActionOutputs } from "./types.js";
import { parseInputs, setOutputs } from "./utils.js";

/**
 * Main entry point for the GitHub Action
 */
export async function run(): Promise<void> {
    try {
        core.info("🗡 Starting Dagger Action");

        // Parse inputs
        const inputs = parseInputs();
        core.debug(`Inputs: ${JSON.stringify(inputs)}`);

        // Get Dagger binary (install or restore from cache)
        // We do this BEFORE cache setup so we know the resolved version
        const binaryInfo = await getBinary(inputs);

        // Setup Dagger build cache if enabled
        if (inputs.cacheBuilds) {
            // Pass the resolved version and cache version to setup cache
            await setupDaggerCache(binaryInfo.version, inputs.cacheVersion);
        }

        // Save resolved version and cache version for post-action cache saving
        core.saveState("DAGGER_VERSION", binaryInfo.version);
        core.saveState("CACHE_VERSION", inputs.cacheVersion);

        // Execute dagger command if inputs provided
        const execResult = await executeDaggerCommand(inputs, binaryInfo.path);

        // Set outputs (even on failure, so traceURL/output are accessible)
        const outputs: ActionOutputs = {
            daggerVersion: binaryInfo.version,
            cacheHit: binaryInfo.cacheHit,
            binaryPath: binaryInfo.path,
            output: execResult.stdout,
            traceURL: execResult.traceURL,
        };
        setOutputs(outputs);

        // Add binary to PATH
        core.addPath(binaryInfo.dir);

        // Write summary if requested
        await writeSummary(inputs, execResult);

        // Fail the action if the command exited with a non-zero code
        if (execResult.exitCode !== 0) {
            core.setFailed(`Dagger command exited with code ${execResult.exitCode}`);
            return;
        }

        core.info("✅ Dagger Action completed successfully");
    } catch (error) {
        core.setFailed(
            `Action failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Post-action cleanup - saves Dagger build cache
 */
export async function post(): Promise<void> {
    try {
        core.info("💾 Running post-action: Saving Dagger build cache");
        core.info(`STATE_isPost env var: ${process.env.STATE_isPost || "not set"}`);

        const inputs = parseInputs();
        core.info(`cache-builds input: ${inputs.cacheBuilds}`);

        if (inputs.cacheBuilds) {
            core.info("Build cache is enabled, proceeding to save...");

            // Get resolved version and cache version from state
            const version = core.getState("DAGGER_VERSION") || inputs.version || "latest";
            const cacheVersion = core.getState("CACHE_VERSION") || inputs.cacheVersion || "v2";

            await saveDaggerCache(version, cacheVersion);
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

// Run main if this file is executed directly
if (require.main === module) {
    const isPost = process.env.STATE_isPost === "true";

    // Use console.error for critical startup messages (always visible)
    console.error(
        `[DAGGER-ACTION] Starting. isPost=${isPost}, STATE_isPost=${process.env.STATE_isPost || "not set"}`
    );
    core.info(`Action phase: ${isPost ? "post" : "main"}`);
    core.info(`STATE_isPost: ${process.env.STATE_isPost || "not set"}`);

    if (isPost) {
        console.error("[DAGGER-ACTION] Running POST phase");
        post();
    } else {
        console.error("[DAGGER-ACTION] Running MAIN phase, marking for post");
        // Mark that we'll run post
        core.saveState("isPost", "true");
        core.info("Marked for post-action execution");
        run();
    }
}
