import { describe, expect, it } from "bun:test";
import { calculateRequiredSpace, generateEngineToml } from "../src/engine-config";

describe("engine-config", () => {
    describe("calculateRequiredSpace", () => {
        it("should calculate required space with 3.5x compression ratio + 2GB margin", () => {
            const compressedSize = 1024 * 1024 * 1024; // 1GB
            const result = calculateRequiredSpace(compressedSize);
            // 1GB * 3.5 + 2GB = 5.5GB
            expect(result).toBe(Math.ceil(3.5 * 1024 * 1024 * 1024 + 2 * 1024 * 1024 * 1024));
        });

        it("should handle zero bytes", () => {
            const result = calculateRequiredSpace(0);
            // 0 * 3.5 + 2GB = 2GB
            expect(result).toBe(2 * 1024 * 1024 * 1024);
        });

        it("should handle small archives", () => {
            const compressedSize = 100 * 1024 * 1024; // 100MB
            const result = calculateRequiredSpace(compressedSize);
            // 100MB * 3.5 + 2GB = 350MB + 2GB = ~2.35GB
            expect(result).toBe(Math.ceil(350 * 1024 * 1024 + 2 * 1024 * 1024 * 1024));
        });

        it("should handle large archives", () => {
            const compressedSize = 10 * 1024 * 1024 * 1024; // 10GB
            const result = calculateRequiredSpace(compressedSize);
            // 10GB * 3.5 + 2GB = 35GB + 2GB = 37GB
            expect(result).toBe(Math.ceil(35 * 1024 * 1024 * 1024 + 2 * 1024 * 1024 * 1024));
        });
    });

    describe("generateEngineToml", () => {
        it("should generate static config when hasCacheHit is false", () => {
            const result = generateEngineToml(false);

            expect(result).toContain("[worker.oci]");
            expect(result).toContain('keepDuration = "25h"');
            expect(result).toContain('maxUsedSpace = "75%"');
            expect(result).toContain('reservedSpace = "10GB"');
            expect(result).toContain('minFreeSpace = "20%"');
            expect(result).toContain("[[worker.oci.gcpolicy]]");
        });

        it("should generate static config when estimatedUncompressedSize is undefined", () => {
            const result = generateEngineToml(true, undefined);

            expect(result).toContain("[worker.oci]");
            expect(result).toContain('maxUsedSpace = "75%"');
            expect(result).toContain('minFreeSpace = "20%"');
        });

        it("should generate dynamic config when hasCacheHit is true with cache size", () => {
            const cacheSize = 10 * 1024 * 1024 * 1024; // 10GB
            const result = generateEngineToml(true, cacheSize);

            // cacheSize * 1.5 = 15GB
            expect(result).toContain("[worker.oci]");
            expect(result).toContain('keepDuration = "25h"');
            expect(result).toContain('maxUsedSpace = "15GB"');
            expect(result).toContain('reservedSpace = "10GB"');
            expect(result).toContain('minFreeSpace = "15%"');
            expect(result).toContain("[[worker.oci.gcpolicy]]");
        });

        it("should round up maxUsedSpace to nearest GB", () => {
            // 3GB cache * 1.5 = 4.5GB -> should round up to 5GB
            const cacheSize = 3 * 1024 * 1024 * 1024;
            const result = generateEngineToml(true, cacheSize);

            expect(result).toContain('maxUsedSpace = "5GB"');
        });

        it("should handle very small cache sizes", () => {
            const cacheSize = 100 * 1024 * 1024; // 100MB
            const result = generateEngineToml(true, cacheSize);

            // 100MB * 1.5 = 150MB -> rounds up to 1GB
            expect(result).toContain('maxUsedSpace = "1GB"');
        });
    });

    // Note: writeEngineConfig is tested implicitly via integration tests
    // Unit testing file I/O with environment variable dependencies causes
    // race conditions in parallel test execution
});
