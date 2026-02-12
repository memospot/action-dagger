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

        // Setup Dagger build cache if enabled
        if (inputs.cacheBuilds) {
            await setupDaggerCache();
        }

        // Get Dagger binary (install or restore from cache)
        const binaryInfo = await getBinary(inputs);

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
        core.info("💾 Saving Dagger build cache");

        const inputs = parseInputs();

        if (inputs.cacheBuilds) {
            await saveDaggerCache();
            core.info("✅ Dagger build cache saved");
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

    if (isPost) {
        post();
    } else {
        // Mark that we'll run post
        core.saveState("isPost", "true");
        run();
    }
}
