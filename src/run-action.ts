import * as core from "@actions/core";
import { setupDaggerCache } from "./cache";
import { getBinary } from "./dagger";
import { executeDaggerCommand, writeSummary } from "./exec";
import { parseInputs } from "./parse-inputs";
import { setOutputs } from "./set-outputs";
import type { ActionOutputs } from "./types";

/**
 * Main entry point for the GitHub Action
 */
export async function runAction(): Promise<void> {
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
            // Pass the resolved version, cache key, and compression level to setup cache
            await setupDaggerCache(
                binaryInfo.version,
                inputs.cacheKey,
                inputs.cacheCompression
            );
        }

        // Save resolved version, cache key, and compression level for post-action cache saving
        core.saveState("DAGGER_VERSION", binaryInfo.version);
        core.saveState("CACHE_KEY", inputs.cacheKey || "");
        core.saveState("CACHE_COMPRESSION", inputs.cacheCompression.toString());

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
