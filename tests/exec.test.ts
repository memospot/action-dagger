import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCore, mockExec, resetAllMocks } from "./mocks/actions.js";

// ---------------------------------------------------------------------------
// Module mocks — registered before importing the module under test.
// ---------------------------------------------------------------------------

mock.module("@actions/core", () => mockCore);
mock.module("@actions/exec", () => mockExec);

import type { ExecutionResult } from "../src/exec.js";
// Import AFTER mocks
import {
    assembleCommand,
    executeDaggerCommand,
    extractTraceUrl,
    generateSummary,
    writeSummary,
} from "../src/exec.js";
import type { ActionInputs } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
    return {
        version: "v0.15.0",
        cacheBuilds: false,
        cacheBinary: false,
        commit: "",
        daggerFlags: "",
        verb: "",
        workdir: ".",
        cloudToken: "",
        module: "",
        args: "",
        call: "",
        shell: "",
        summaryPath: "",
        enableGithubSummary: false,
        ...overrides,
    };
}

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
    return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        traceURL: "",
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("exec", () => {
    beforeEach(() => {
        resetAllMocks();
    });

    afterEach(() => {
        delete process.env.GITHUB_STEP_SUMMARY;
    });

    // -----------------------------------------------------------------------
    // assembleCommand — returns string[]
    // -----------------------------------------------------------------------
    describe("assembleCommand", () => {
        it("should use default verb 'call' when no verb specified", () => {
            const inputs = makeInputs({ args: "container --from alpine" });
            const cmd = assembleCommand(inputs);
            expect(cmd).toEqual(["call", "container", "--from", "alpine"]);
        });

        it("should use specified verb", () => {
            const inputs = makeInputs({ verb: "run", args: "./script.sh" });
            const cmd = assembleCommand(inputs);
            expect(cmd).toEqual(["run", "./script.sh"]);
        });

        it("should include module flag as separate args", () => {
            const inputs = makeInputs({
                verb: "call",
                module: "github.com/my/module",
                args: "hello",
            });
            const cmd = assembleCommand(inputs);
            expect(cmd).toEqual(["call", "-m", "github.com/my/module", "hello"]);
        });

        it("should override verb to 'call' when call input is provided", () => {
            const inputs = makeInputs({
                verb: "run",
                call: "hello --greeting Hola",
            });
            const cmd = assembleCommand(inputs);
            expect(cmd).toContain("call");
            expect(cmd).toContain("hello");
            expect(cmd).toContain("--greeting");
            expect(cmd).toContain("Hola");
        });

        it("should return shell as -c argument", () => {
            const shell = "container | from alpine | with-exec echo,hello | stdout";
            const inputs = makeInputs({ shell });
            const cmd = assembleCommand(inputs);
            // Shell content should be passed as a single argument to -c
            expect(cmd).toEqual(["-c", shell]);
        });

        it("should preserve multi-line shell content as single -c arg", () => {
            const shell = `container |
  from --address alpine |
  with-exec -- echo "hello world" |
  stdout`;
            const inputs = makeInputs({ shell });
            const cmd = assembleCommand(inputs);

            expect(cmd).toEqual(["-c", shell]);
        });

        it("should include dagger flags as separate args", () => {
            const inputs = makeInputs({
                daggerFlags: "--progress plain --debug",
                verb: "call",
                args: "hello",
            });
            const cmd = assembleCommand(inputs);
            expect(cmd).toEqual(["--progress", "plain", "--debug", "call", "hello"]);
        });

        it("should preserve dagger flags when shell is used", () => {
            const inputs = makeInputs({
                daggerFlags: "--progress plain",
                shell: "container | from alpine | stdout",
            });
            const cmd = assembleCommand(inputs);
            expect(cmd).toEqual([
                "--progress",
                "plain",
                "-c",
                "container | from alpine | stdout",
            ]);
        });

        it("should handle empty args gracefully", () => {
            const inputs = makeInputs({ verb: "functions" });
            const cmd = assembleCommand(inputs);
            expect(cmd).toEqual(["functions"]);
        });
        it("should handle multiline args with quotes (repro for --platforms)", () => {
            const args =
                'build --source . --version v1.2.3 --platforms "linux/amd64,linux/arm64"';
            const inputs = makeInputs({
                verb: "call",
                args: args,
            });
            const cmd = assembleCommand(inputs);

            expect(cmd).toEqual([
                "call",
                "build",
                "--source",
                ".",
                "--version",
                "v1.2.3",
                "--platforms",
                "linux/amd64,linux/arm64",
            ]);
        });

        it("should handle multiline args with spaces in quotes", () => {
            const args = 'build --platforms "linux/amd64, linux/arm64"';
            const inputs = makeInputs({ args });
            const cmd = assembleCommand(inputs);
            expect(cmd).toEqual(["call", "build", "--platforms", "linux/amd64, linux/arm64"]);
        });

        it("should handle empty quoted string", () => {
            const args = 'build --platforms ""';
            const inputs = makeInputs({ args });
            const cmd = assembleCommand(inputs);
            expect(cmd).toEqual(["call", "build", "--platforms", ""]);
        });
    });

    // -----------------------------------------------------------------------
    // extractTraceUrl
    // -----------------------------------------------------------------------
    describe("extractTraceUrl", () => {
        it("should extract trace URL from stderr", () => {
            const stderr = `#47 DONE
Full trace at https://dagger.cloud/myorg/traces/abc123def
#48 exporting layers`;
            const url = extractTraceUrl(stderr);
            expect(url).toBe("https://dagger.cloud/myorg/traces/abc123def");
        });
        it("should extract setup trace URL", () => {
            const stderr = "To setup tracing, visit https://dagger.cloud/traces/setup";
            const url = extractTraceUrl(stderr);
            expect(url).toBe("https://dagger.cloud/traces/setup");
        });

        it("should return empty string when no trace URL found", () => {
            const stderr = "Some normal output without any trace URL";
            const url = extractTraceUrl(stderr);
            expect(url).toBe("");
        });

        it("should return empty string for empty stderr", () => {
            const url = extractTraceUrl("");
            expect(url).toBe("");
        });
    });

    // -----------------------------------------------------------------------
    // generateSummary
    // -----------------------------------------------------------------------
    describe("generateSummary", () => {
        it("should include command section", () => {
            const inputs = makeInputs({ verb: "call", args: "hello" });
            const result = makeResult();
            const summary = generateSummary(inputs, result);

            expect(summary).toContain("## Command");
            expect(summary).toContain("dagger");
        });

        it("should include trace URL when present", () => {
            const inputs = makeInputs({ verb: "call", args: "hello" });
            const result = makeResult({
                traceURL: "https://dagger.cloud/org/traces/abc123",
            });
            const summary = generateSummary(inputs, result);

            expect(summary).toContain("https://dagger.cloud/org/traces/abc123");
        });

        it("should show setup message when no trace URL", () => {
            const inputs = makeInputs({ verb: "call", args: "hello" });
            const result = makeResult({ traceURL: "" });
            const summary = generateSummary(inputs, result);

            expect(summary).toContain("No trace available");
            expect(summary).toContain("dagger.cloud/traces/setup");
        });

        it("should include script section for shell input", () => {
            const inputs = makeInputs({
                shell: "container | from alpine | stdout",
            });
            const result = makeResult();
            const summary = generateSummary(inputs, result);

            expect(summary).toContain("### Script");
            expect(summary).toContain("container | from alpine | stdout");
        });

        it("should include module in command when provided", () => {
            const inputs = makeInputs({
                verb: "call",
                module: "github.com/my/mod",
                args: "hello",
            });
            const result = makeResult();
            const summary = generateSummary(inputs, result);

            expect(summary).toContain("DAGGER_MODULE=");
            expect(summary).toContain("github.com/my/mod");
        });

        it("should include dagger version section", () => {
            const inputs = makeInputs({ verb: "call", args: "hello" });
            const result = makeResult();
            const summary = generateSummary(inputs, result);

            expect(summary).toContain("## Dagger version");
        });
    });

    // -----------------------------------------------------------------------
    // executeDaggerCommand
    // -----------------------------------------------------------------------
    describe("executeDaggerCommand", () => {
        it("should not execute when no args/call/shell provided", async () => {
            // Default inputs have verb="call" but no args/call/shell.
            // Should NOT trigger execution (install-only use case).
            const inputs = makeInputs({ verb: "call" });
            const result = await executeDaggerCommand(inputs, "/usr/bin/dagger");

            expect(result.stdout).toBe("");
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(result.traceURL).toBe("");
            expect(mockExec._trackers.exec.calls).toHaveLength(0);
        });

        it("should not execute with empty inputs", async () => {
            const inputs = makeInputs(); // no verb/args/call/shell
            const result = await executeDaggerCommand(inputs, "/usr/bin/dagger");

            expect(result.exitCode).toBe(0);
            expect(mockExec._trackers.exec.calls).toHaveLength(0);
        });

        it("should execute command and capture output", async () => {
            mockExec._setExecResult(0, "hello world\n", "");

            const inputs = makeInputs({ verb: "call", args: "hello" });
            const result = await executeDaggerCommand(inputs, "/usr/bin/dagger");

            expect(result.stdout).toBe("hello world\n");
            expect(result.exitCode).toBe(0);
            expect(mockExec._trackers.exec.calls).toHaveLength(1);

            // First arg should be the binary path
            const callArgs = mockExec._trackers.exec.calls[0].args;
            expect(callArgs[0]).toBe("/usr/bin/dagger");
        });

        it("should pass args array to exec (not split string)", async () => {
            mockExec._setExecResult(0, "", "");

            const inputs = makeInputs({
                daggerFlags: "--progress plain",
                verb: "call",
                args: "hello --name World",
            });
            await executeDaggerCommand(inputs, "/usr/bin/dagger");

            const callArgs = mockExec._trackers.exec.calls[0].args;
            // Second arg should be the args array
            const execArgs = callArgs[1] as string[];
            expect(execArgs).toEqual([
                "--progress",
                "plain",
                "call",
                "hello",
                "--name",
                "World",
            ]);
        });

        it("should extract trace URL from stderr", async () => {
            mockExec._setExecResult(
                0,
                "ok",
                "Full trace at https://dagger.cloud/myorg/traces/abc123"
            );

            const inputs = makeInputs({ call: "build" });
            const result = await executeDaggerCommand(inputs, "/usr/bin/dagger");

            expect(result.traceURL).toBe("https://dagger.cloud/myorg/traces/abc123");
        });

        it("should set DAGGER_CLOUD_TOKEN env when cloudToken provided", async () => {
            mockExec._setExecResult(0, "", "");

            const inputs = makeInputs({
                verb: "call",
                args: "hello",
                cloudToken: "test-cloud-token",
            });
            await executeDaggerCommand(inputs, "/usr/bin/dagger");

            const execCall = mockExec._trackers.exec.calls[0];
            const options = execCall.args[2] as { env?: Record<string, string> };
            expect(options?.env?.DAGGER_CLOUD_TOKEN).toBe("test-cloud-token");
        });

        it("should handle non-zero exit codes", async () => {
            mockExec._setExecResult(1, "", "error: something went wrong");

            const inputs = makeInputs({ verb: "call", args: "failing-func" });
            const result = await executeDaggerCommand(inputs, "/usr/bin/dagger");

            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("something went wrong");

            // Should have logged a warning about non-zero exit
            expect(mockCore._trackers.warning.calls.length).toBeGreaterThan(0);
        });

        it("should pass workdir to exec options", async () => {
            mockExec._setExecResult(0, "", "");

            const inputs = makeInputs({
                verb: "call",
                args: "hello",
                workdir: "/my/project",
            });
            await executeDaggerCommand(inputs, "/usr/bin/dagger");

            const execCall = mockExec._trackers.exec.calls[0];
            const options = execCall.args[2] as { cwd?: string };
            expect(options?.cwd).toBe("/my/project");
        });
    });

    // -----------------------------------------------------------------------
    // writeSummary
    // -----------------------------------------------------------------------
    describe("writeSummary", () => {
        it("should not write if neither summaryPath nor github summary enabled", async () => {
            const inputs = makeInputs({
                verb: "call",
                args: "hello",
                summaryPath: "",
                enableGithubSummary: false,
            });
            const result = makeResult();

            // Should simply complete without error
            await writeSummary(inputs, result);
        });
    });
});
