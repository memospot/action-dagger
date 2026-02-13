/**
 * Action input configuration
 */
export interface ActionInputs {
    /** Dagger CLI version to install */
    version: string;
    /** Enable Dagger build cache persistence */
    cacheBuilds: boolean;
    /** Cache Dagger binary to avoid re-downloading */
    cacheBinary: boolean;
    /** Cache version for cache invalidation */
    cacheVersion: string;
    commit: string;
    daggerFlags: string;
    verb: string;
    workdir: string;
    cloudToken: string;
    module: string;
    args: string;
    call: string;
    shell: string;
    summaryPath: string;
    enableGithubSummary: boolean;
}

/**
 * Action output configuration
 */
export interface ActionOutputs {
    /** Installed Dagger version */
    daggerVersion: string;
    /** Whether binary was restored from cache */
    cacheHit: boolean;
    /** Path to installed Dagger binary */
    binaryPath: string;
    /** Command stdout output (legacy) */
    output: string;
    /** Dagger Cloud trace URL */
    traceURL: string;
}

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

/**
 * Cache configuration for Dagger build cache
 */
export interface CacheConfig {
    /** Cache key for build cache */
    key: string;
    /** Paths to cache */
    paths: string[];
    /** Restore keys for partial matches */
    restoreKeys: string[];
}

/**
 * GitHub Actions context information
 */
export interface GitHubContext {
    workflow: string;
    job: string;
    runId: string;
    repository: string;
    sha: string;
    ref: string;
}
