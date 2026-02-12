import * as fs from "node:fs";
import * as path from "node:path";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import type { ActionInputs, BinaryInfo, PlatformInfo } from "./types.js";
import { logDebug, logInfo, logWarning } from "./utils.js";

const DAGGER_GITHUB_REPO = "dagger/dagger";
const DAGGER_DOWNLOAD_URL = "https://dl.dagger.io/dagger";
const GITHUB_RELEASES_URL = `https://github.com/${DAGGER_GITHUB_REPO}/releases/download`;

/**
 * Get the Dagger binary - checks cache first, downloads if needed
 */
export async function getBinary(inputs: ActionInputs): Promise<BinaryInfo> {
    const platform = getPlatformInfo();
    logDebug(`Platform: ${platform.platform}/${platform.arch}`);

    // Determine version to install
    let version = inputs.version;
    if (version === "latest") {
        version = await getLatestVersion();
        logInfo(`Latest Dagger version: ${version}`);
    }

    // Normalize version (ensure it starts with 'v')
    if (!version.startsWith("v")) {
        version = `v${version}`;
    }

    // Check if caching is enabled
    if (inputs.cacheBinary) {
        const cachedPath = tc.find("dagger", version, platform.arch);
        if (cachedPath) {
            logInfo(`✓ Found cached Dagger ${version}`);
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
    logInfo(`Downloading Dagger ${version}...`);
    const binaryInfo = await downloadAndInstall(version, platform);

    // Cache the binary if enabled
    if (inputs.cacheBinary) {
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
export function getPlatformInfo(): PlatformInfo {
    const archMap: Record<string, string> = {
        x64: "amd64",
        arm64: "arm64",
    };

    const platformMap: Record<string, string> = {
        win32: "windows",
        darwin: "darwin",
        linux: "linux",
    };

    const downloadArch = archMap[process.arch] || process.arch;
    const downloadPlatform = platformMap[process.platform] || process.platform;

    return {
        platform: downloadPlatform,
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
        logWarning(`Failed to fetch latest version: ${error}`);
        // Fallback to a known recent version
        return "v0.15.0";
    }
}

/**
 * Download and install Dagger binary with fallback to GitHub releases
 */
async function downloadAndInstall(
    version: string,
    platform: PlatformInfo
): Promise<BinaryInfo> {
    const { primary: primaryUrl, fallback: fallbackUrl } = getDownloadUrls(version, platform);

    // Try primary URL first, then fallback
    let downloadPath: string;
    let usedUrl: string;

    try {
        logDebug(`Attempting primary download: ${primaryUrl}`);
        downloadPath = await tc.downloadTool(primaryUrl);
        usedUrl = primaryUrl;
        logInfo(`✓ Downloaded from primary source`);
    } catch (primaryError) {
        logWarning(`Primary download failed: ${primaryError}`);
        logInfo(`Attempting fallback download from GitHub releases...`);

        try {
            // Check for GITHUB_TOKEN for authenticated requests
            const githubToken = process.env.GITHUB_TOKEN;
            const headers: Record<string, string> | undefined = githubToken
                ? { Authorization: `Bearer ${githubToken}` }
                : undefined;

            if (githubToken) {
                logDebug("Using GITHUB_TOKEN for authenticated download");
            }

            downloadPath = await tc.downloadTool(fallbackUrl, undefined, undefined, headers);
            usedUrl = fallbackUrl;
            logInfo(`✓ Downloaded from GitHub releases fallback`);
        } catch (fallbackError) {
            throw new Error(
                `Failed to download Dagger binary from both primary and fallback URLs. ` +
                    `Primary error: ${primaryError}. Fallback error: ${fallbackError}`
            );
        }
    }

    logDebug(`Downloaded to: ${downloadPath}`);

    // Extract archive
    let extractedPath: string;
    if (usedUrl.endsWith(".zip")) {
        extractedPath = await tc.extractZip(downloadPath);
    } else {
        extractedPath = await tc.extractTar(downloadPath, undefined, "xz");
    }

    logDebug(`Extracted to: ${extractedPath}`);

    // Find the binary
    const binaryName = platform.platform === "windows" ? "dagger.exe" : "dagger";
    const binaryPath = path.join(extractedPath, binaryName);

    // Make binary executable on Unix systems
    if (platform.platform !== "windows") {
        fs.chmodSync(binaryPath, 0o755);
    }

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
    platform: PlatformInfo
): { primary: string; fallback: string } {
    const archiveExt = platform.platform === "windows" ? "zip" : "tar.gz";
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
        await tc.cacheDir(binaryInfo.dir, "dagger", binaryInfo.version, binaryInfo.arch);
        logDebug(`Cached Dagger ${binaryInfo.version}`);
    } catch (error) {
        logWarning(`Failed to cache binary: ${error}`);
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
        logDebug(`Binary verification: ${stdout.trim()}`);
    } catch (error) {
        throw new Error(`Binary verification failed: ${error}`);
    }
}
