import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";

/**
 * Configuration for the Dagger engine GC policy.
 *
 * https://docs.dagger.io/reference/configuration/engine/#garbage-collection
 */
interface GcPolicy {
    // Matches cache records older than the given amount (e.g. 30s, 5m, 4h).
    keepDuration: string;
    // The maximum amount of disk space that may be used by this buildkit worker - any usage above this threshold will be reclaimed during garbage collection.
    maxUsedSpace: string;
    // The minimum amount of disk space guaranteed to be retained by this buildkit worker.
    // Any usage below this threshold will not be reclaimed during garbage collection.
    reservedSpace: string;
    // The target amount of free disk space that the garbage collector will attempt to leave empty - however, it will never be bought below reservedSpace.
    minFreeSpace: string;
}

/**
 * Configuration for the Dagger engine worker
 */
interface EngineConfig {
    gcPolicies: GcPolicy[];
}

/**
 * Default compression ratio for cache estimation
 * Based on empirical data showing ~3.5:1 compression
 */
const DEFAULT_COMPRESSION_RATIO = 3.5;

/**
 * Safety margin in bytes to add to space calculations
 */
const SAFETY_MARGIN_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

/**
 * Static configuration values when no cache hit
 * These are conservative defaults suitable for fresh volumes
 */
const STATIC_CONFIG: EngineConfig = {
    gcPolicies: [
        {
            keepDuration: "25h",
            maxUsedSpace: "75%",
            reservedSpace: "10GB",
            minFreeSpace: "20%",
        },
    ],
};

/**
 * Calculate required free space for cache restore
 *
 * @param compressedSize - Size of compressed cache archive in bytes
 * @returns Required free space in bytes (compressed × ratio + safety margin)
 */
export function calculateRequiredSpace(compressedSize: number): number {
    const uncompressedEstimate = compressedSize * DEFAULT_COMPRESSION_RATIO;
    return Math.ceil(uncompressedEstimate + SAFETY_MARGIN_BYTES);
}

/**
 * Generate engine.toml content based on cache configuration
 *
 * @param hasCacheHit - Whether cache was successfully restored
 * @param estimatedUncompressedSize - Expected uncompressed cache size in bytes (for dynamic config)
 * @returns TOML content as string
 */
export function generateEngineToml(
    hasCacheHit: boolean,
    estimatedUncompressedSize?: number
): string {
    if (!hasCacheHit || !estimatedUncompressedSize) {
        core.debug("Using static engine config (no cache hit or unknown cache size)");
        return renderToml(STATIC_CONFIG);
    }

    // Dynamic config for cache hit
    // Reserve space for cache + 50% margin for growth during build
    const maxUsedSpaceBytes = Math.ceil(estimatedUncompressedSize * 1.5);
    const maxUsedSpaceGb = Math.ceil(maxUsedSpaceBytes / (1024 * 1024 * 1024));

    const dynamicConfig: EngineConfig = {
        gcPolicies: [
            {
                keepDuration: "25h",
                maxUsedSpace: `${maxUsedSpaceGb}GB`,
                reservedSpace: "10GB",
                minFreeSpace: "15%",
            },
        ],
    };

    core.debug(
        `Using dynamic engine config: maxUsedSpace=${maxUsedSpaceGb}GB, cacheSize=${Math.ceil(estimatedUncompressedSize / (1024 * 1024 * 1024))}GB`
    );
    return renderToml(dynamicConfig);
}

/**
 * Render engine configuration to TOML format
 *
 * @param config - Engine configuration
 * @returns TOML formatted string
 */
function renderToml(config: EngineConfig): string {
    const lines: string[] = ["[worker.oci]"];

    // Add main worker config from first GC policy
    const mainPolicy = config.gcPolicies[0];
    lines.push(`keepDuration = "${mainPolicy.keepDuration}"`);
    lines.push(`maxUsedSpace = "${mainPolicy.maxUsedSpace}"`);
    lines.push(`reservedSpace = "${mainPolicy.reservedSpace}"`);
    lines.push(`minFreeSpace = "${mainPolicy.minFreeSpace}"`);

    // Add explicit GC policy entries
    for (const policy of config.gcPolicies) {
        lines.push("");
        lines.push("[[worker.oci.gcpolicy]]");
        lines.push(`keepDuration = "${policy.keepDuration}"`);
        lines.push(`maxUsedSpace = "${policy.maxUsedSpace}"`);
        lines.push(`reservedSpace = "${policy.reservedSpace}"`);
        lines.push(`minFreeSpace = "${policy.minFreeSpace}"`);
    }

    return lines.join("\n");
}

/**
 * Write engine.toml to a temporary file
 *
 * @param content - TOML content to write
 * @returns Path to the written file
 */
export function writeEngineConfig(content: string): string {
    const tempDir = process.env.RUNNER_TEMP || "/tmp";
    const configPath = path.join(tempDir, "dagger-engine.toml");
    fs.writeFileSync(configPath, content, "utf-8");
    core.debug(`Wrote engine config to ${configPath}`);
    return configPath;
}
