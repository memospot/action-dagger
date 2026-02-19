/**
 * Version comparison utilities for Dagger version handling.
 *
 * Handles semantic version comparison with support for:
 * - "v" prefix normalization (v0.15.0 → 0.15.0)
 * - "latest" version handling
 * - Standard major.minor.patch format
 */

/**
 * Normalize a version string by removing the "v" prefix if present.
 *
 * @param version - Version string (e.g., "v0.15.0" or "0.15.0")
 * @returns Normalized version without "v" prefix
 */
export function normalizeVersion(version: string): string {
    return version.replace(/^v/, "");
}

/**
 * Compare two semantic versions.
 * Returns true if version >= target.
 *
 * Handles:
 * - "v" prefix (automatically stripped)
 * - Standard semver format (major.minor.patch)
 * - Partial versions (treats missing parts as 0)
 *
 * @param version - The version to check (e.g., "v0.15.0", "0.16.0")
 * @param target - The target version to compare against (e.g., "0.15.0")
 * @returns true if version >= target, false otherwise
 */
export function isVersionAtLeast(version: string, target: string): boolean {
    // Handle special case: "latest" is always >= any version
    if (version === "latest") {
        return true;
    }

    const v1 = normalizeVersion(version);
    const v2 = normalizeVersion(target);

    // Parse version parts
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    // Compare major, then minor, then patch
    for (let i = 0; i < 3; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return true;
        if (p1 < p2) return false;
    }

    return true; // Equal
}
