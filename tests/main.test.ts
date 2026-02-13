import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
    mockCache,
    mockCore,
    mockExec,
    mockToolCache,
    resetAllMocks,
} from "./mocks/actions.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

mock.module("@actions/core", () => mockCore);
mock.module("@actions/cache", () => mockCache);
mock.module("@actions/tool-cache", () => mockToolCache);
mock.module("@actions/exec", () => mockExec);

mock.module("node:fs", () => ({
    ...require("node:fs"),
    existsSync: () => true,
    mkdirSync: () => undefined,
    chmodSync: () => undefined,
}));

// Import AFTER mocks
import { post, run } from "../src/main.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("main", () => {
    beforeEach(() => {
        resetAllMocks();
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (key.startsWith("INPUT_")) {
                delete process.env[key];
            }
        }
    });

    // -----------------------------------------------------------------------
    // run()
    // -----------------------------------------------------------------------
    describe("run", () => {
        it("should set outputs and add binary to PATH on success", async () => {
            process.env.INPUT_VERSION = "v0.15.0";

            await run();

            const outputNames = mockCore._trackers.setOutput.calls.map(
                (c) => c.args[0] as string
            );
            expect(outputNames).toContain("dagger-version");
            expect(outputNames).toContain("cache-hit");
            expect(outputNames).toContain("binary-path");

            expect(mockCore._trackers.addPath.calls).toHaveLength(1);
            expect(mockCore._trackers.setFailed.calls).toHaveLength(0);
        });

        it("should call setupDaggerCache (export env vars) when cache-builds is enabled", async () => {
            process.env.INPUT_VERSION = "v0.15.0";
            process.env.INPUT_CACHE_BUILDS = "true";

            await run();

            // Should export cache env vars
            const exportCalls = mockCore._trackers.exportVariable.calls.map((c) => c.args[0]);
            expect(exportCalls).toContain("DAGGER_CACHE_TO");
            expect(exportCalls).toContain("DAGGER_CACHE_FROM");

            // Should NOT use actions/cache restore
            expect(mockCache._trackers.restoreCache.calls).toHaveLength(0);
        });

        it("should not call setupDaggerCache when cache-builds is disabled", async () => {
            process.env.INPUT_VERSION = "v0.15.0";
            process.env.INPUT_CACHE_BUILDS = "false";

            await run();

            // Should NOT export cache env vars
            const exportCalls = mockCore._trackers.exportVariable.calls.map((c) => c.args[0]);
            expect(exportCalls).not.toContain("DAGGER_CACHE_TO");

            expect(mockCache._trackers.restoreCache.calls).toHaveLength(0);
        });

        it("should call setFailed on unexpected error", async () => {
            mockToolCache._setDownloadShouldFail(true);

            process.env.INPUT_VERSION = "v0.15.0";

            await run();

            expect(mockCore._trackers.setFailed.calls).toHaveLength(1);
            const msg = mockCore._trackers.setFailed.calls[0].args[0] as string;
            expect(msg).toContain("Action failed");
        });
    });

    // -----------------------------------------------------------------------
    // post()
    // -----------------------------------------------------------------------
    describe("post", () => {
        it("should be a no-op even when cache-builds is enabled (handled by Dagger)", async () => {
            process.env.INPUT_CACHE_BUILDS = "true";

            await post();

            // Should NOT call saveCache
            expect(mockCache._trackers.saveCache.calls).toHaveLength(0);
        });

        it("should skip save when cache-builds is disabled", async () => {
            process.env.INPUT_CACHE_BUILDS = "false";

            await post();

            expect(mockCache._trackers.saveCache.calls).toHaveLength(0);
        });
    });
});

// ---------------------------------------------------------------------------
// utils (kept from original but improved)
// ---------------------------------------------------------------------------
describe("utils", () => {
    beforeEach(() => {
        resetAllMocks();
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (key.startsWith("INPUT_")) {
                delete process.env[key];
            }
        }
    });

    describe("setOutputs", () => {
        it("should set all three outputs correctly", async () => {
            const { setOutputs } = await import("../src/utils.js");

            setOutputs({
                daggerVersion: "v0.15.0",
                cacheHit: true,
                binaryPath: "/usr/local/bin/dagger",
                output: "test output",
                traceURL: "https://dagger.cloud/traces/abc123",
            });

            const outputNames = mockCore._trackers.setOutput.calls.map(
                (c) => c.args[0] as string
            );
            expect(outputNames).toContain("dagger-version");
            expect(outputNames).toContain("cache-hit");
            expect(outputNames).toContain("binary-path");
            expect(outputNames).toContain("output");
            expect(outputNames).toContain("traceURL");

            const outputMap = Object.fromEntries(
                mockCore._trackers.setOutput.calls.map((c) => [c.args[0], c.args[1]])
            );
            expect(outputMap["dagger-version"]).toBe("v0.15.0");
            expect(outputMap["cache-hit"]).toBe("true");
            expect(outputMap["binary-path"]).toBe("/usr/local/bin/dagger");
        });
    });

    describe("parseInputs", () => {
        it("should parse inputs from environment variables", async () => {
            process.env.INPUT_VERSION = "v0.15.0";
            process.env.INPUT_CACHE_BUILDS = "true";
            process.env.INPUT_CACHE_BINARY = "false";
            process.env.INPUT_WORKDIR = "./my-app";

            const { parseInputs } = await import("../src/utils.js");
            const inputs = parseInputs();

            expect(inputs.version).toBe("v0.15.0");
            expect(inputs.cacheBuilds).toBe(true);
            expect(inputs.cacheBinary).toBe(false);
            expect(inputs.workdir).toBe("./my-app");
        });

        it("should default version to 'latest' when not specified", async () => {
            delete process.env.INPUT_VERSION;

            const { parseInputs } = await import("../src/utils.js");
            const inputs = parseInputs();

            expect(inputs.version).toBe("latest");
        });
    });

    describe("logging", () => {
        it("should call the corresponding @actions/core methods", async () => {
            const { logInfo, logDebug, logWarning, logError } = await import("../src/utils.js");

            logInfo("info msg");
            logDebug("debug msg");
            logWarning("warn msg");
            logError("error msg");

            expect(mockCore._trackers.info.calls).toHaveLength(1);
            expect(mockCore._trackers.info.calls[0].args[0]).toBe("info msg");

            expect(mockCore._trackers.debug.calls).toHaveLength(1);
            expect(mockCore._trackers.debug.calls[0].args[0]).toBe("debug msg");

            expect(mockCore._trackers.warning.calls).toHaveLength(1);
            expect(mockCore._trackers.warning.calls[0].args[0]).toBe("warn msg");

            expect(mockCore._trackers.error.calls).toHaveLength(1);
            expect(mockCore._trackers.error.calls[0].args[0]).toBe("error msg");
        });
    });
});
