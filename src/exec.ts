import * as core from "@actions/core";
import * as exec from "@actions/exec";
import type { ActionInputs } from "./input-parse";

import type { ExecutionResult } from "./output-summary";

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

    core.info("Executing Dagger command…");

    // Assemble the command arguments
    const commandArgs = assembleCommand(inputs);
    core.debug(`Command: ${commandArgs.join(" ")}`);

    // Set up environment
    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            env[key] = value;
        }
    }
    if (inputs.cloudToken) {
        env.DAGGER_CLOUD_TOKEN = inputs.cloudToken;
        core.debug("Using Dagger Cloud token");
    }

    // Execute the command
    const result = await executeCommand(binaryPath, commandArgs, inputs.workdir, env);

    // Extract trace URL from stderr
    const traceURL = extractTraceUrl(result.stderr);
    if (traceURL) {
        core.info(`Dagger Cloud trace: ${traceURL}`);
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

    core.debug(`Executing: ${binaryPath} ${args.join(" ")}`);

    const exitCode = await exec.exec(binaryPath, args, options);

    const stdoutStr = stdout.join("");
    const stderrStr = stderr.join("");

    if (exitCode !== 0) {
        core.warning(`Command exited with code ${exitCode}`);
        core.debug(`stderr: ${stderrStr}`);
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
