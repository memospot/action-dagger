import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { getDockerSocketPath, isRoot } from "../src/docker";

describe("OS Compatibility Utils", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
        mock.restore();
    });

    describe("shouldUseSudo", () => {
        it("should return false if uid is 0 (root)", () => {
            expect(isRoot(0)).toBe(true);
        });

        it("should return true if uid is not 0", () => {
            expect(isRoot(1000)).toBe(false);
        });

        it("should return true if getuid is undefined", () => {
            expect(isRoot(undefined)).toBe(false);
        });
    });

    describe("getDockerSocketPath", () => {
        it("should return default path if DOCKER_HOST is not set", () => {
            delete process.env.DOCKER_HOST;
            expect(getDockerSocketPath()).toBe("/var/run/docker.sock");
        });

        it("should return path from unix:// DOCKER_HOST", () => {
            process.env.DOCKER_HOST = "unix:///run/user/1000/docker.sock";
            expect(getDockerSocketPath()).toBe("/run/user/1000/docker.sock");
        });

        it("should use fallback for non-unix DOCKER_HOST", () => {
            process.env.DOCKER_HOST = "tcp://localhost:2375";
            expect(getDockerSocketPath()).toBe("/var/run/docker.sock");
        });
    });
});
