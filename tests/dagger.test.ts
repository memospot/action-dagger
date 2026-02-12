import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockCore, mockExec, mockToolCache, resetAllMocks } from "./mocks/actions.js";

// ---------------------------------------------------------------------------
// Module mocks — registered before importing the module under test.
// ---------------------------------------------------------------------------

mock.module("@actions/core", () => mockCore);
mock.module("@actions/tool-cache", () => mockToolCache);
mock.module("@actions/exec", () => mockExec);

mock.module("node:fs", () => ({
    ...require("node:fs"),
    existsSync: () => true,
    mkdirSync: () => undefined,
    chmodSync: () => undefined,
}));

import {
    getBinary,
    getDownloadUrls,
    getLatestVersion,
    getPlatformInfo,
} from "../src/dagger.js";
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
        workdir: "",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dagger", () => {
    beforeEach(() => {
        resetAllMocks();
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
    });

    // -----------------------------------------------------------------------
    // getPlatformInfo
    // -----------------------------------------------------------------------
    describe("getPlatformInfo", () => {
        it("should return platform information", () => {
            const info = getPlatformInfo();

            expect(info).toHaveProperty("platform");
            expect(info).toHaveProperty("arch");
            expect(info).toHaveProperty("downloadArch");
            expect(["linux", "darwin", "windows"]).toContain(info.platform);
            expect(["amd64", "arm64", "arm"]).toContain(info.downloadArch);
        });

        it("should normalize x64 to amd64", () => {
            const originalArch = process.arch;
            Object.defineProperty(process, "arch", {
                value: "x64",
                configurable: true,
            });

            const info = getPlatformInfo();
            expect(info.downloadArch).toBe("amd64");

            Object.defineProperty(process, "arch", {
                value: originalArch,
                configurable: true,
            });
        });

        it("should normalize arm64 to arm64", () => {
            const originalArch = process.arch;
            Object.defineProperty(process, "arch", {
                value: "arm64",
                configurable: true,
            });

            const info = getPlatformInfo();
            expect(info.downloadArch).toBe("arm64");

            Object.defineProperty(process, "arch", {
                value: originalArch,
                configurable: true,
            });
        });

        it("should pass through unknown architectures unchanged", () => {
            const originalArch = process.arch;
            Object.defineProperty(process, "arch", {
                value: "s390x",
                configurable: true,
            });

            const info = getPlatformInfo();
            expect(info.downloadArch).toBe("s390x");

            Object.defineProperty(process, "arch", {
                value: originalArch,
                configurable: true,
            });
        });
    });

    // -----------------------------------------------------------------------
    // getLatestVersion (mocked fetch)
    // -----------------------------------------------------------------------
    describe("getLatestVersion", () => {
        it("should return version from the remote endpoint", async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async () => ({
                ok: true,
                text: async () => "v0.18.3\n",
            })) as unknown as typeof fetch;

            const version = await getLatestVersion();
            expect(version).toBe("v0.18.3");

            globalThis.fetch = originalFetch;
        });

        it("should fall back to v0.15.0 on HTTP error", async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async () => ({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
            })) as unknown as typeof fetch;

            const version = await getLatestVersion();
            expect(version).toBe("v0.15.0");

            globalThis.fetch = originalFetch;
        });

        it("should fall back to v0.15.0 on network error", async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async () => {
                throw new Error("Network unreachable");
            }) as unknown as typeof fetch;

            const version = await getLatestVersion();
            expect(version).toBe("v0.15.0");

            globalThis.fetch = originalFetch;
        });
    });

    // -----------------------------------------------------------------------
    // getDownloadUrls
    // -----------------------------------------------------------------------
    describe("getDownloadUrls", () => {
        it("should return both primary and fallback URLs", () => {
            const platform = getPlatformInfo();
            const urls = getDownloadUrls("v0.15.0", platform);

            expect(urls).toHaveProperty("primary");
            expect(urls).toHaveProperty("fallback");
        });

        it("should use correct filename format in URLs", () => {
            const platform = getPlatformInfo();
            const version = "v0.15.0";
            const urls = getDownloadUrls(version, platform);

            const primaryFilename = urls.primary.split("/").pop();
            const fallbackFilename = urls.fallback.split("/").pop();
            expect(primaryFilename).toBe(fallbackFilename);

            const expectedExt = platform.platform === "windows" ? "zip" : "tar.gz";
            expect(primaryFilename).toMatch(
                new RegExp(
                    `^dagger_0\\.15\\.0_${platform.platform}_${platform.downloadArch}\\.${expectedExt}$`
                )
            );
        });

        it("should use correct base URLs", () => {
            const platform = getPlatformInfo();
            const urls = getDownloadUrls("v0.15.0", platform);

            expect(urls.primary).toMatch(
                /^https:\/\/dl\.dagger\.io\/dagger\/releases\/v0\.15\.0\//
            );
            expect(urls.fallback).toMatch(
                /^https:\/\/github\.com\/dagger\/dagger\/releases\/download\/v0\.15\.0\//
            );
        });

        it("should strip the v prefix from the filename", () => {
            const platform = getPlatformInfo();
            const urls = getDownloadUrls("v1.2.3", platform);
            const filename = urls.primary.split("/").pop() ?? "";

            expect(filename).toContain("1.2.3");
            expect(filename).not.toMatch(/^dagger_v/);
        });

        it("should use .zip extension for windows", () => {
            const urls = getDownloadUrls("v0.15.0", {
                platform: "windows",
                arch: "amd64",
                downloadArch: "amd64",
            });
            expect(urls.primary).toMatch(/\.zip$/);
            expect(urls.fallback).toMatch(/\.zip$/);
        });

        it("should use .tar.gz extension for linux", () => {
            const urls = getDownloadUrls("v0.15.0", {
                platform: "linux",
                arch: "amd64",
                downloadArch: "amd64",
            });
            expect(urls.primary).toMatch(/\.tar\.gz$/);
            expect(urls.fallback).toMatch(/\.tar\.gz$/);
        });
    });

    // -----------------------------------------------------------------------
    // getBinary
    // -----------------------------------------------------------------------
    describe("getBinary", () => {
        it("should download and return binary info when cache is disabled", async () => {
            const inputs = makeInputs({ version: "v0.15.0", cacheBinary: false });

            const result = await getBinary(inputs);

            expect(result.version).toBe("v0.15.0");
            expect(result.cacheHit).toBe(false);
            expect(result.path).toBeDefined();
            expect(result.platform).toBeDefined();

            expect(mockToolCache._trackers.downloadTool.calls.length).toBeGreaterThan(0);
            expect(mockExec._trackers.getExecOutput.calls.length).toBeGreaterThan(0);
        });

        it("should prepend v to version when missing", async () => {
            const inputs = makeInputs({ version: "0.15.0", cacheBinary: false });

            const result = await getBinary(inputs);

            expect(result.version).toBe("v0.15.0");
        });

        it("should resolve 'latest' version via getLatestVersion", async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async () => ({
                ok: true,
                text: async () => "v0.18.5\n",
            })) as unknown as typeof fetch;

            const inputs = makeInputs({ version: "latest", cacheBinary: false });

            const result = await getBinary(inputs);

            expect(result.version).toBe("v0.18.5");

            globalThis.fetch = originalFetch;
        });

        it("should return cached binary when cache hit", async () => {
            mockToolCache._setFindResult("/opt/hostedtoolcache/dagger/v0.15.0/amd64");

            const inputs = makeInputs({ version: "v0.15.0", cacheBinary: true });

            const result = await getBinary(inputs);

            expect(result.cacheHit).toBe(true);
            expect(result.dir).toBe("/opt/hostedtoolcache/dagger/v0.15.0/amd64");
            expect(mockToolCache._trackers.downloadTool.calls).toHaveLength(0);
        });

        it("should download and cache binary on cache miss", async () => {
            mockToolCache._setFindResult(""); // miss

            const inputs = makeInputs({ version: "v0.15.0", cacheBinary: true });

            const result = await getBinary(inputs);

            expect(result.cacheHit).toBe(false);
            expect(mockToolCache._trackers.downloadTool.calls.length).toBeGreaterThan(0);
            expect(mockToolCache._trackers.cacheDir.calls).toHaveLength(1);
        });

        it("should fall back to GitHub releases when primary download fails", async () => {
            // First download call fails (primary), second succeeds (fallback)
            mockToolCache._setDownloadFailUntilCall(1);

            const inputs = makeInputs({ version: "v0.15.0", cacheBinary: false });
            const result = await getBinary(inputs);

            expect(result.cacheHit).toBe(false);

            // Two download attempts should have been made
            expect(mockToolCache._trackers.downloadTool.calls).toHaveLength(2);

            // Second call should be to GitHub releases fallback
            const secondUrl = mockToolCache._trackers.downloadTool.calls[1].args[0] as string;
            expect(secondUrl).toContain("github.com");
        });

        it("should throw when both primary and fallback downloads fail", async () => {
            mockToolCache._setDownloadShouldFail(true);

            const inputs = makeInputs({ version: "v0.15.0", cacheBinary: false });

            await expect(getBinary(inputs)).rejects.toThrow(
                /Failed to download Dagger binary from both primary and fallback/
            );
        });

        it("should use GITHUB_TOKEN for authenticated fallback downloads", async () => {
            process.env.GITHUB_TOKEN = "test-token-12345";
            mockToolCache._setDownloadFailUntilCall(1);

            const inputs = makeInputs({ version: "v0.15.0", cacheBinary: false });
            await getBinary(inputs);

            // Second call (fallback) should include auth header
            const fallbackCall = mockToolCache._trackers.downloadTool.calls[1];
            const headers = fallbackCall.args[3] as Record<string, string> | undefined;

            expect(headers).toBeDefined();
            expect(headers?.Authorization).toBe("Bearer test-token-12345");
        });

        it("should not include auth header when GITHUB_TOKEN is not set", async () => {
            delete process.env.GITHUB_TOKEN;
            mockToolCache._setDownloadFailUntilCall(1);

            const inputs = makeInputs({ version: "v0.15.0", cacheBinary: false });
            await getBinary(inputs);

            const fallbackCall = mockToolCache._trackers.downloadTool.calls[1];
            const headers = fallbackCall.args[3];

            expect(headers).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // Platform-specific tests
    // -----------------------------------------------------------------------
    describe("platform detection", () => {
        it("should detect windows platform correctly", () => {
            const originalPlatform = process.platform;
            const originalArch = process.arch;

            Object.defineProperty(process, "platform", {
                value: "win32",
                configurable: true,
            });
            Object.defineProperty(process, "arch", {
                value: "x64",
                configurable: true,
            });

            const info = getPlatformInfo();
            expect(info.platform).toBe("windows");
            expect(info.downloadArch).toBe("amd64");

            Object.defineProperty(process, "platform", {
                value: originalPlatform,
                configurable: true,
            });
            Object.defineProperty(process, "arch", {
                value: originalArch,
                configurable: true,
            });
        });

        it("should detect darwin platform correctly", () => {
            const originalPlatform = process.platform;
            const originalArch = process.arch;

            Object.defineProperty(process, "platform", {
                value: "darwin",
                configurable: true,
            });
            Object.defineProperty(process, "arch", {
                value: "arm64",
                configurable: true,
            });

            const info = getPlatformInfo();
            expect(info.platform).toBe("darwin");
            expect(info.downloadArch).toBe("arm64");

            Object.defineProperty(process, "platform", {
                value: originalPlatform,
                configurable: true,
            });
            Object.defineProperty(process, "arch", {
                value: originalArch,
                configurable: true,
            });
        });

        it("should detect linux platform correctly", () => {
            const originalPlatform = process.platform;
            const originalArch = process.arch;

            Object.defineProperty(process, "platform", {
                value: "linux",
                configurable: true,
            });
            Object.defineProperty(process, "arch", {
                value: "x64",
                configurable: true,
            });

            const info = getPlatformInfo();
            expect(info.platform).toBe("linux");
            expect(info.downloadArch).toBe("amd64");

            Object.defineProperty(process, "platform", {
                value: originalPlatform,
                configurable: true,
            });
            Object.defineProperty(process, "arch", {
                value: originalArch,
                configurable: true,
            });
        });
    });
});
