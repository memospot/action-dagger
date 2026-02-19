import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { setupDaggerCache } from "./cache";
import { getBinary } from "./dagger";
import { getAvailableDiskSpace } from "./disk-space";
import { pullDaggerImage } from "./engine";
import { executeDaggerCommand } from "./exec";
import { parseInputs } from "./input-parse";
import type { ActionOutputs } from "./output-set";
import { setOutputs } from "./output-set";
import { writeSummary } from "./output-summary";
import { withTimeout } from "./timeout";
import { isVersionAtLeast } from "./version";

const BUSYBOX_PULL_TIMEOUT_MS = 15_000;

/**
 * Pull busybox image in background for cache backup operations.
 *
 * The pull is time-bounded so it does not keep the action alive.
 */
function pullBusyBoxInBackground(): void {
    core.debug("Starting BusyBox image pull in background for cache operations...");

    void withTimeout(
        exec.exec("timeout", ["15s", "docker", "pull", "busybox:latest"], {
            silent: true,
            ignoreReturnCode: true,
        }),
        BUSYBOX_PULL_TIMEOUT_MS,
        "Background BusyBox image pull"
    ).catch((error) => {
        core.debug(`Background BusyBox pull skipped/timed out (non-critical): ${error}`);
    });
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
}

/**
 * Main entry point for the GitHub Action
 */
export async function runAction(): Promise<void> {
    try {
        if (process.platform !== "linux") {
            core.setFailed("🚫 This action only supports Linux runners");
            return;
        }

        core.info("🗡 Starting Dagger Action");

        // Log initial disk space
        const tempDir = process.env.RUNNER_TEMP || "/tmp";
        const initialDiskSpace = await getAvailableDiskSpace(tempDir);
        core.info(`💾 Initial free disk space: ${formatBytes(initialDiskSpace)}`);

        // Parse inputs
        const inputs = parseInputs();
        core.debug(`Inputs: ${JSON.stringify(inputs)}`);

        // Validate version (must be >= v0.15.0, unless using a commit)
        if (!inputs.commit && !isVersionAtLeast(inputs.version, "0.15.0")) {
            core.setFailed(
                `🚫 Dagger version ${inputs.version} is not supported. ` +
                    `This action requires Dagger v0.15.0 or later. ` +
                    `For older versions, please use https://github.com/dagger/dagger-for-github instead.`
            );
            return;
        }

        // Warn if using a commit that might be too old
        if (inputs.commit) {
            core.warning(
                `⚠️ Using Dagger from commit ${inputs.commit}. ` +
                    `This action may fail if the commit points to a version older than v0.15.0.`
            );
        }

        // Get Dagger binary (install or restore from cache)
        // We do this BEFORE cache setup so we know the resolved version
        const binaryInfo = await getBinary(inputs);

        // Setup Dagger build cache if enabled
        if (inputs.cacheBuilds) {
            // Pre-pull busybox image in background for faster cache backup later
            pullBusyBoxInBackground();

            // Start Dagger image pull in background while cache restores
            // This parallelizes image download with cache I/O
            const imagePullPromise = pullDaggerImage(binaryInfo.version);

            // Pass the resolved version, cache key, cache mode, and image pull promise
            await setupDaggerCache(
                binaryInfo.version,
                inputs.cacheKey,
                inputs.cacheMode,
                imagePullPromise
            );
        }

        // Save resolved version, cache key, and cache mode for post-action cache saving
        core.saveState("DAGGER_VERSION", binaryInfo.version);
        core.saveState("CACHE_KEY", inputs.cacheKey || "");
        core.saveState("CACHE_MODE", inputs.cacheMode);

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
            `🚫 Action failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
