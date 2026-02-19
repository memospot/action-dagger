import * as core from "@actions/core";
import { assembleCommand } from "./exec";
import type { ActionInputs } from "./input-parse";

/**
 * Result of executing a dagger command
 */
export interface ExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    traceURL: string;
}

/**
 * Generate job summary content
 */
export function generateSummary(inputs: ActionInputs, result: ExecutionResult): string {
    const lines: string[] = [];

    // Command section
    lines.push("## Command\n");
    lines.push("```bash");

    const cmd = assembleCommand(inputs).join(" ");
    if (inputs.module) {
        lines.push(`DAGGER_MODULE="${inputs.module}" dagger ${cmd}`);
    } else {
        lines.push(`dagger ${cmd}`);
    }
    lines.push("```\n");

    // Script section for shell input
    if (inputs.shell) {
        lines.push("### Script\n");
        lines.push("```bash");
        lines.push(inputs.shell);
        lines.push("```\n");
    }

    // Dagger trace section
    lines.push("## Dagger trace\n");
    if (result.traceURL) {
        lines.push(`[${result.traceURL}](${result.traceURL})`);
    } else {
        lines.push(
            "No trace available. To setup: [https://dagger.cloud/traces/setup](https://dagger.cloud/traces/setup)"
        );
    }
    lines.push("\n");

    // Dagger version section
    lines.push("## Dagger version\n");
    lines.push("```bash");
    lines.push(`dagger version`);
    lines.push("```\n");

    lines.push("---\n");

    return lines.join("\n");
}

/**
 * Write summary to appropriate destinations
 */
export async function writeSummary(
    inputs: ActionInputs,
    result: ExecutionResult
): Promise<void> {
    const summary = generateSummary(inputs, result);

    // Write to custom path if specified
    if (inputs.summaryPath) {
        try {
            const fs = await import("node:fs");
            fs.writeFileSync(inputs.summaryPath, summary);
            core.debug(`Summary written to ${inputs.summaryPath}`);
        } catch (error) {
            core.warning(`Failed to write summary to ${inputs.summaryPath}: ${error}`);
        }
    }

    // Write to GITHUB_STEP_SUMMARY if enabled
    if (inputs.enableGithubSummary) {
        const githubStepSummary = process.env.GITHUB_STEP_SUMMARY;
        if (githubStepSummary) {
            try {
                const fs = await import("node:fs");
                fs.writeFileSync(githubStepSummary, summary);
                core.debug("Summary written to GITHUB_STEP_SUMMARY");
            } catch (error) {
                core.warning(`Failed to write summary: ${error}`);
            }
        }
    }
}
