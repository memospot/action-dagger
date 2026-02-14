import * as exec from "@actions/exec";
import { logDebug, logInfo, logWarning } from "./logger";
import type { ActionInputs } from "./types";

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
 * Execute dagger command with given inputs
 */
export async function executeDaggerCommand(
    inputs: ActionInputs,
    binaryPath: string
): Promise<ExecutionResult> {
    // Check if we have anything to execute
    if (!shouldExecuteCommand(inputs)) {
        return {
            stdout: "",
            stderr: "",
            exitCode: 0,
            traceURL: "",
        };
    }

    logInfo("Executing Dagger command...");

    // Assemble the command arguments
    const commandArgs = assembleCommand(inputs);
    logDebug(`Command: ${commandArgs.join(" ")}`);

    // Set up environment
    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            env[key] = value;
        }
    }
    if (inputs.cloudToken) {
        env.DAGGER_CLOUD_TOKEN = inputs.cloudToken;
        logDebug("Using Dagger Cloud token");
    }

    // Execute the command
    const result = await executeCommand(binaryPath, commandArgs, inputs.workdir, env);

    // Extract trace URL from stderr
    const traceURL = extractTraceUrl(result.stderr);
    if (traceURL) {
        logInfo(`Dagger Cloud trace: ${traceURL}`);
    }

    return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        traceURL,
    };
}

/**
 * Check if we should execute a command based on inputs.
 * Only triggers when the user explicitly provides args, call, or shell.
 * Does NOT include verb since it has a default value ('call').
 */
function shouldExecuteCommand(inputs: ActionInputs): boolean {
    return !!(inputs.args || inputs.call || inputs.shell);
}

/**
 * Assemble dagger command arguments from inputs.
 * Returns an array of arguments to avoid whitespace splitting issues
 * that plagued the old bash-based action.
 */
export function assembleCommand(inputs: ActionInputs): string[] {
    const parts: string[] = [];

    // Add dagger flags (split into individual flags)
    if (inputs.daggerFlags) {
        parts.push(...inputs.daggerFlags.split(/\s+/).filter(Boolean));
    }

    // Handle shell input - it bypasses verb but keeps flags.
    // We treat shell input as a single command string passed with -c
    if (inputs.shell) {
        parts.push("-c", inputs.shell);
        return parts;
    }

    // Determine verb and arguments
    let verb = inputs.verb || "call";
    let args = inputs.args;

    // Call input overrides verb
    if (inputs.call) {
        verb = "call";
        args = inputs.call;
    }

    // Add verb
    parts.push(verb);

    // Add module flag if provided
    if (inputs.module) {
        parts.push("-m", inputs.module);
    }

    // Add arguments (split into individual args)
    if (args) {
        parts.push(...splitArgs(args));
    }

    return parts;
}

/**
 * Split a string into arguments, respecting single and double quotes.
 * Examples:
 *   'echo "hello world"' -> ['echo', 'hello world']
 *   'arg1 arg2' -> ['arg1', 'arg2']
 */
export function splitArgs(str: string): string[] {
    const args: string[] = [];
    let current = "";
    let inDoubleQuote = false;
    let inSingleQuote = false;
    let tokenStarted = false;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];

        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            tokenStarted = true;
            continue;
        }

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            tokenStarted = true;
            continue;
        }

        if (char === " " && !inDoubleQuote && !inSingleQuote) {
            if (tokenStarted) {
                args.push(current);
                current = "";
                tokenStarted = false;
            }
        } else {
            current += char;
            tokenStarted = true;
        }
    }

    if (tokenStarted) {
        args.push(current);
    }

    return args;
}

/**
 * Execute the dagger command and capture output.
 * Takes pre-assembled args array to avoid whitespace splitting issues.
 */
async function executeCommand(
    binaryPath: string,
    args: string[],
    workdir: string,
    env: { [key: string]: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const options: exec.ExecOptions = {
        cwd: workdir,
        env,
        listeners: {
            stdout: (data: Buffer) => {
                stdout.push(data.toString());
            },
            stderr: (data: Buffer) => {
                stderr.push(data.toString());
            },
        },
        ignoreReturnCode: true, // We'll handle the exit code ourselves
    };

    logDebug(`Executing: ${binaryPath} ${args.join(" ")}`);

    const exitCode = await exec.exec(binaryPath, args, options);

    const stdoutStr = stdout.join("");
    const stderrStr = stderr.join("");

    if (exitCode !== 0) {
        logWarning(`Command exited with code ${exitCode}`);
        logDebug(`stderr: ${stderrStr}`);
    }

    return {
        stdout: stdoutStr,
        stderr: stderrStr,
        exitCode,
    };
}

/**
 * Extract Dagger Cloud trace URL from stderr
 */
export function extractTraceUrl(stderr: string): string {
    // Match patterns like:
    // https://dagger.cloud/org/traces/abc123
    // https://dagger.cloud/traces/setup
    const tracePattern =
        /https:\/\/dagger\.cloud(\/[^\s/]+\/traces\/[a-zA-Z0-9]+|\/traces\/setup)/;
    const match = stderr.match(tracePattern);

    if (match) {
        return match[0];
    }

    return "";
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
            logDebug(`Summary written to ${inputs.summaryPath}`);
        } catch (error) {
            logWarning(`Failed to write summary to ${inputs.summaryPath}: ${error}`);
        }
    }

    // Write to GITHUB_STEP_SUMMARY if enabled
    if (inputs.enableGithubSummary) {
        const githubStepSummary = process.env.GITHUB_STEP_SUMMARY;
        if (githubStepSummary) {
            try {
                const fs = await import("node:fs");
                fs.writeFileSync(githubStepSummary, summary);
                logDebug("Summary written to GITHUB_STEP_SUMMARY");
            } catch (error) {
                logWarning(`Failed to write summary: ${error}`);
            }
        }
    }
}
