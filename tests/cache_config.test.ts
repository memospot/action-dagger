import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as core from "@actions/core";
import { getCacheDirectory, setupDaggerCache } from "../src/cache.js";

// Mock @actions/core
mock.module("@actions/core", () => ({
    exportVariable: mock(),
    saveState: mock(),
    getState: mock(() => ""),
    debug: mock(),
    info: mock(),
    warning: mock(),
    error: mock(),
    getInput: mock(() => ""),
    getBooleanInput: mock(() => false),
    setOutput: mock(),
}));

// Mock @actions/cache
mock.module("@actions/cache", () => ({
    restoreCache: mock(() => Promise.resolve("found-cache-key")),
    saveCache: mock(() => Promise.resolve(1)),
}));

describe("setupDaggerCache", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env.GITHUB_WORKSPACE = "/tmp/test-workspace";
    });

    afterEach(() => {
        process.env = originalEnv;
        // clear mocks
        (core.exportVariable as any).mockClear();
    });

    test("exports correct environment variables for cache", async () => {
        // Create dummy cache dir
        const cacheDir = getCacheDirectory();
        fs.mkdirSync(cacheDir, { recursive: true });

        await setupDaggerCache();

        // Verify DAGGER_CACHE_TO
        expect(core.exportVariable).toHaveBeenCalledWith(
            "DAGGER_CACHE_TO",
            expect.stringContaining(`type=local,dest=${cacheDir},mode=max`)
        );

        // Verify DAGGER_CACHE_FROM
        expect(core.exportVariable).toHaveBeenCalledWith(
            "DAGGER_CACHE_FROM",
            expect.stringContaining(`type=local,src=${cacheDir}`)
        );

        // Verify _EXPERIMENTAL_DAGGER_CACHE_CONFIG (legacy) includes dest and mode=max
        expect(core.exportVariable).toHaveBeenCalledWith(
            "_EXPERIMENTAL_DAGGER_CACHE_CONFIG",
            expect.stringContaining(`type=local,src=${cacheDir},dest=${cacheDir},mode=max`)
        );
    });
});
