import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import type { ActionInputs } from "./input-parse";

/**
 * Platform architecture mapping
 */
export interface PlatformInfo {
    platform: string;
    arch: string;
    downloadArch: string;
}

/**
 * Dagger binary information
 */
export interface BinaryInfo {
    version: string;
    path: string;
    platform: string;
    arch: string;
    dir: string;
    cacheHit: boolean;
}

const DAGGER_GITHUB_REPO = "dagger/dagger";
const DAGGER_DOWNLOAD_URL = "https://dl.dagger.io/dagger";
const GITHUB_RELEASES_URL = `https://github.com/${DAGGER_GITHUB_REPO}/releases/download`;

/**
 * Get the Dagger binary - checks cache first, downloads if needed
 */
export async function getBinary(inputs: ActionInputs): Promise<BinaryInfo> {
    const platform = getPlatformInfo();
    core.debug(`Platform: ${platform.platform}/${platform.arch}`);

    // Determine version to install
    let version = inputs.version;
    if (inputs.commit) {
        version = inputs.commit;
        core.info(`Using Dagger commit: ${version}`);
    } else if (version === "latest") {
        version = await getLatestVersion();
        core.info(`Latest Dagger version: ${version}`);
    }

    // Normalize version (ensure it starts with 'v' if it's a semantic version)
    // Commits don't start with 'v'
    if (!inputs.commit && !version.startsWith("v")) {
        version = `v${version}`;
    }

    // Check if caching is enabled
    // We don't cache commit builds for now to avoid complexity with naming
    if (inputs.cacheBinary && !inputs.commit) {
        const cachedPath = tc.find("dagger", version, platform.arch);
        if (cachedPath) {
            core.info(`✓ Found cached Dagger ${version}`);
            const binaryPath = path.join(cachedPath, "dagger");
            return {
                version,
                path: binaryPath,
                platform: platform.platform,
                arch: platform.arch,
                dir: cachedPath,
                cacheHit: true,
            };
        }
    }

    // Download and install
    core.info(`Downloading Dagger ${version}…`);
    const binaryInfo = await downloadAndInstall(version, platform, !!inputs.commit);

    // Cache the binary if enabled
    if (inputs.cacheBinary && !inputs.commit) {
        await cacheBinary(binaryInfo);
    }

    return {
        ...binaryInfo,
        cacheHit: false,
    };
}

/**
 * Get platform information
 */
/**
 * Get platform information (Linux only)
 */
export function getPlatformInfo(): PlatformInfo {
    const archMap: Record<string, string> = {
        x64: "amd64",
        arm64: "arm64",
    };

    const downloadArch = archMap[process.arch] || process.arch;

    return {
        platform: "linux",
        arch: downloadArch,
        downloadArch,
    };
}

/**
 * Fetch the latest Dagger version from GitHub
 */
export async function getLatestVersion(): Promise<string> {
    try {
        const url = `${DAGGER_DOWNLOAD_URL}/versions/latest`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const version = await response.text();
        return version.trim();
    } catch (error) {
        core.warning(`Failed to fetch latest version: ${error}`);
        // Fallback to a known recent version
        return "v0.15.0";
    }
}

/**
 * Download and install Dagger binary with fallback to GitHub releases
 */
async function downloadAndInstall(
    version: string,
    platform: PlatformInfo,
    isCommit = false
): Promise<BinaryInfo> {
    const { primary: primaryUrl, fallback: fallbackUrl } = getDownloadUrls(
        version,
        platform,
        isCommit
    );

    // Try primary URL first, then fallback
    let downloadPath: string;

    try {
        core.debug(`Attempting primary download: ${primaryUrl}`);
        downloadPath = await tc.downloadTool(primaryUrl);
        core.info(`✓ Downloaded from primary source`);
    } catch (primaryError) {
        if (!fallbackUrl) {
            throw primaryError;
        }

        core.warning(`Primary download failed: ${primaryError}`);
        core.info(`Attempting fallback download from GitHub releases…`);

        // Check for GITHUB_TOKEN for authenticated requests
        const githubToken = process.env.GITHUB_TOKEN;
        const headers: Record<string, string> | undefined = githubToken
            ? { Authorization: `Bearer ${githubToken}` }
            : undefined;

        if (githubToken) {
            core.debug("Using GITHUB_TOKEN for authenticated download");
        }

        downloadPath = await tc
            .downloadTool(fallbackUrl, undefined, undefined, headers)
            .then((path) => {
                core.info(`✓ Downloaded from GitHub releases fallback`);
                return path;
            })
            .catch((fallbackError) => {
                throw new Error(
                    `Failed to download Dagger binary from both primary and fallback URLs. ` +
                        `Primary error: ${primaryError}. Fallback error: ${fallbackError}`
                );
            });
    }

    core.debug(`Downloaded to: ${downloadPath}`);

    // Extract archive
    const extractedPath = await tc.extractTar(downloadPath, undefined, "xz");

    core.debug(`Extracted to: ${extractedPath}`);

    // Find the binary
    const binaryName = "dagger";
    const binaryPath = path.join(extractedPath, binaryName);

    // Make binary executable
    fs.chmodSync(binaryPath, 0o755);

    // Verify the binary works
    await verifyBinary(binaryPath);

    return {
        version,
        path: binaryPath,
        platform: platform.platform,
        arch: platform.arch,
        dir: extractedPath,
        cacheHit: false,
    };
}

/**
 * Get download URLs for a specific version and platform
 * Returns both primary (dl.dagger.io) and fallback (GitHub releases) URLs
 */
export function getDownloadUrls(
    version: string,
    platform: PlatformInfo,
    isCommit = false
): { primary: string; fallback?: string } {
    const archiveExt = "tar.gz";

    if (isCommit) {
        // Commit builds follow the pattern: dl.dagger.io/dagger/main/<commit>/dagger_<commit>_<platform>_<arch>.<ext>
        const filename = `dagger_${version.replace(/^v/, "")}_${platform.platform}_${platform.downloadArch}.${archiveExt}`;
        return {
            primary: `${DAGGER_DOWNLOAD_URL}/main/${version}/${filename}`,
            fallback: undefined, // No GitHub release for random commits
        };
    }

    const filename = `dagger_${version}_${platform.platform}_${platform.downloadArch}.${archiveExt}`;
    return {
        primary: `${DAGGER_DOWNLOAD_URL}/releases/${version.replace(/^v/, "")}/${filename}`,
        fallback: `${GITHUB_RELEASES_URL}/${version}/${filename}`,
    };
}

/**
 * Cache the binary using tool-cache
 */
async function cacheBinary(binaryInfo: BinaryInfo): Promise<void> {
    try {
        core.debug(
            `Caching binary to tool-cache: tool=dagger, version=${binaryInfo.version}, arch=${binaryInfo.arch}`
        );
        core.debug(`Source directory: ${binaryInfo.dir}`);
        const cachedPath = await tc.cacheDir(
            binaryInfo.dir,
            "dagger",
            binaryInfo.version,
            binaryInfo.arch
        );
        core.info(`✓ Cached Dagger ${binaryInfo.version} to ${cachedPath}`);
    } catch (error) {
        core.warning(`Failed to cache binary: ${error}`);
    }
}

/**
 * Verify the binary is working
 */
async function verifyBinary(binaryPath: string): Promise<void> {
    try {
        const { stdout } = await exec.getExecOutput(binaryPath, ["version"], {
            silent: true,
        });
        core.debug(`Binary verification: ${stdout.trim()}`);
    } catch (error) {
        throw new Error(`Binary verification failed: ${error}`);
    }
}
