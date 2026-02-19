import { describe, expect, it } from "bun:test";
import { isVersionAtLeast, normalizeVersion } from "../src/version";

describe("version", () => {
    describe("normalizeVersion", () => {
        it("should remove v prefix from version", () => {
            expect(normalizeVersion("v0.15.0")).toBe("0.15.0");
            expect(normalizeVersion("v1.0.0")).toBe("1.0.0");
        });

        it("should leave version without v prefix unchanged", () => {
            expect(normalizeVersion("0.15.0")).toBe("0.15.0");
            expect(normalizeVersion("1.0.0")).toBe("1.0.0");
        });

        it("should handle versions with only major.minor", () => {
            expect(normalizeVersion("v0.15")).toBe("0.15");
            expect(normalizeVersion("0.15")).toBe("0.15");
        });

        it("should handle version with v in the middle", () => {
            expect(normalizeVersion("0.15.0-v1")).toBe("0.15.0-v1");
        });
    });

    describe("isVersionAtLeast", () => {
        it("should return true for exact version match", () => {
            expect(isVersionAtLeast("0.15.0", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("v0.15.0", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("0.15.0", "v0.15.0")).toBe(true);
        });

        it("should return true for greater version", () => {
            expect(isVersionAtLeast("0.16.0", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("0.15.1", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("1.0.0", "0.15.0")).toBe(true);
        });

        it("should return false for lesser version", () => {
            expect(isVersionAtLeast("0.14.0", "0.15.0")).toBe(false);
            expect(isVersionAtLeast("0.13.5", "0.15.0")).toBe(false);
            expect(isVersionAtLeast("0.14.9", "0.15.0")).toBe(false);
        });

        it("should handle v prefix correctly", () => {
            expect(isVersionAtLeast("v0.16.0", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("v0.14.0", "0.15.0")).toBe(false);
            expect(isVersionAtLeast("0.16.0", "v0.15.0")).toBe(true);
        });

        it("should treat latest as always >= target", () => {
            expect(isVersionAtLeast("latest", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("latest", "9.99.99")).toBe(true);
        });

        it("should handle major version differences", () => {
            expect(isVersionAtLeast("1.0.0", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("0.99.99", "1.0.0")).toBe(false);
        });

        it("should handle partial versions", () => {
            expect(isVersionAtLeast("0.15", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("0.16", "0.15.0")).toBe(true);
            expect(isVersionAtLeast("0.14", "0.15.0")).toBe(false);
        });
    });
});
