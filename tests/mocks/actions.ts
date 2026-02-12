/**
 * Stateful, inspectable mock implementations for GitHub Actions modules.
 *
 * Each mock tracks its calls so tests can assert on interactions.
 * Call `resetAllMocks()` between tests to get a clean slate.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Call {
    args: unknown[];
}

function createTracker() {
    const calls: Call[] = [];
    return {
        calls,
        track(...args: unknown[]) {
            calls.push({ args });
        },
        reset() {
            calls.length = 0;
        },
    };
}

// ---------------------------------------------------------------------------
// @actions/core
// ---------------------------------------------------------------------------

const coreTrackers = {
    setOutput: createTracker(),
    setFailed: createTracker(),
    info: createTracker(),
    debug: createTracker(),
    warning: createTracker(),
    error: createTracker(),
    addPath: createTracker(),
    exportVariable: createTracker(),
    saveState: createTracker(),
    getState: createTracker(),
};

const stateStore: Record<string, string> = {};

export const mockCore = {
    _trackers: coreTrackers,
    _stateStore: stateStore,

    getInput: (name: string, options?: { required?: boolean }): string => {
        const envKey = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
        const value = process.env[envKey];
        if (options?.required && !value) {
            throw new Error(`Input required and not supplied: ${name}`);
        }
        return value || "";
    },

    getBooleanInput: (name: string): boolean => {
        const envKey = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
        const value = process.env[envKey];
        return value === "true";
    },

    setOutput: (name: string, value: string): void => {
        coreTrackers.setOutput.track(name, value);
    },

    setFailed: (message: string): void => {
        coreTrackers.setFailed.track(message);
    },

    info: (message: string): void => {
        coreTrackers.info.track(message);
    },

    debug: (message: string): void => {
        coreTrackers.debug.track(message);
    },

    warning: (message: string): void => {
        coreTrackers.warning.track(message);
    },

    error: (message: string): void => {
        coreTrackers.error.track(message);
    },

    addPath: (inputPath: string): void => {
        coreTrackers.addPath.track(inputPath);
    },

    exportVariable: (name: string, val: string): void => {
        coreTrackers.exportVariable.track(name, val);
    },

    saveState: (name: string, value: string): void => {
        coreTrackers.saveState.track(name, value);
        stateStore[name] = value;
    },

    getState: (name: string): string => {
        coreTrackers.getState.track(name);
        return stateStore[name] || "";
    },
};

// ---------------------------------------------------------------------------
// @actions/cache
// ---------------------------------------------------------------------------

const cacheTrackers = {
    restoreCache: createTracker(),
    saveCache: createTracker(),
};

let restoreCacheResult: string | undefined;
let saveCacheResult = 0;
let restoreShouldFail = false;
let saveShouldFail = false;

export const mockCache = {
    _trackers: cacheTrackers,

    _setRestoreResult(result: string | undefined) {
        restoreCacheResult = result;
    },
    _setSaveResult(result: number) {
        saveCacheResult = result;
    },
    _setRestoreShouldFail(fail: boolean) {
        restoreShouldFail = fail;
    },
    _setSaveShouldFail(fail: boolean) {
        saveShouldFail = fail;
    },

    restoreCache: async (
        paths: string[],
        primaryKey: string,
        restoreKeys?: string[]
    ): Promise<string | undefined> => {
        cacheTrackers.restoreCache.track(paths, primaryKey, restoreKeys);
        if (restoreShouldFail) {
            throw new Error("Mock restore failure");
        }
        return restoreCacheResult;
    },

    saveCache: async (paths: string[], key: string): Promise<number> => {
        cacheTrackers.saveCache.track(paths, key);
        if (saveShouldFail) {
            throw new Error("Mock save failure");
        }
        return saveCacheResult;
    },
};

// ---------------------------------------------------------------------------
// @actions/tool-cache
// ---------------------------------------------------------------------------

const tcTrackers = {
    downloadTool: createTracker(),
    extractTar: createTracker(),
    extractZip: createTracker(),
    cacheDir: createTracker(),
    find: createTracker(),
};

let findResult = "";
let downloadShouldFail = false;
/** If > 0, fail on calls with index < this value, succeed afterwards. */
let downloadFailUntilCall = 0;
let downloadCallCount = 0;

export const mockToolCache = {
    _trackers: tcTrackers,

    _setFindResult(result: string) {
        findResult = result;
    },
    _setDownloadShouldFail(fail: boolean) {
        downloadShouldFail = fail;
    },
    /** Fail the first N calls then succeed. Useful for testing fallback. */
    _setDownloadFailUntilCall(n: number) {
        downloadFailUntilCall = n;
    },

    downloadTool: async (
        url: string,
        _dest?: string,
        _auth?: string,
        _headers?: Record<string, string>
    ): Promise<string> => {
        downloadCallCount++;
        tcTrackers.downloadTool.track(url, _dest, _auth, _headers);
        if (downloadShouldFail) {
            throw new Error("Mock download failure");
        }
        if (downloadFailUntilCall > 0 && downloadCallCount <= downloadFailUntilCall) {
            throw new Error(`Mock download failure (call ${downloadCallCount})`);
        }
        return "/tmp/downloaded-tool";
    },

    extractTar: async (file: string, dest?: string, _flags?: string): Promise<string> => {
        tcTrackers.extractTar.track(file, dest, _flags);
        return dest || "/tmp/extracted";
    },

    extractZip: async (file: string, dest?: string): Promise<string> => {
        tcTrackers.extractZip.track(file, dest);
        return dest || "/tmp/extracted";
    },

    cacheDir: async (
        sourceDir: string,
        tool: string,
        version: string,
        arch?: string
    ): Promise<string> => {
        tcTrackers.cacheDir.track(sourceDir, tool, version, arch);
        return `/opt/hostedtoolcache/${tool}/${version}/${arch || "x64"}`;
    },

    find: (toolName: string, versionSpec: string, arch?: string): string => {
        tcTrackers.find.track(toolName, versionSpec, arch);
        return findResult;
    },
};

// ---------------------------------------------------------------------------
// @actions/exec
// ---------------------------------------------------------------------------

let execExitCode = 0;
let execStdout = "dagger v0.15.0";
let execStderr = "";
let execShouldFail = false;

const execTrackers = {
    exec: createTracker(),
    getExecOutput: createTracker(),
};

export const mockExec = {
    _trackers: execTrackers,

    _setExecResult: (exitCode: number, stdout: string, stderr: string): void => {
        execExitCode = exitCode;
        execStdout = stdout;
        execStderr = stderr;
    },

    _setExecShouldFail: (shouldFail: boolean): void => {
        execShouldFail = shouldFail;
    },

    exec: async (
        commandLine: string,
        args?: string[],
        options?: {
            listeners?: { stdout?: (data: Buffer) => void; stderr?: (data: Buffer) => void };
            [key: string]: unknown;
        }
    ): Promise<number> => {
        execTrackers.exec.track(commandLine, args, options);

        if (execShouldFail) {
            throw new Error("Mock exec failed");
        }

        // Call listeners to simulate streaming output
        if (options?.listeners?.stdout && execStdout) {
            options.listeners.stdout(Buffer.from(execStdout));
        }
        if (options?.listeners?.stderr && execStderr) {
            options.listeners.stderr(Buffer.from(execStderr));
        }

        return execExitCode;
    },

    getExecOutput: async (
        commandLine: string,
        args?: string[],
        options?: unknown
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        execTrackers.getExecOutput.track(commandLine, args, options);
        return { exitCode: 0, stdout: "dagger v0.15.0", stderr: "" };
    },
};

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

export function resetAllMocks(): void {
    // Core
    for (const t of Object.values(coreTrackers)) t.reset();
    for (const key of Object.keys(stateStore))
        delete stateStore[key as keyof typeof stateStore];

    // Cache
    for (const t of Object.values(cacheTrackers)) t.reset();
    restoreCacheResult = undefined;
    saveCacheResult = 0;
    restoreShouldFail = false;
    saveShouldFail = false;

    // Tool-cache
    for (const t of Object.values(tcTrackers)) t.reset();
    findResult = "";
    downloadShouldFail = false;
    downloadFailUntilCall = 0;
    downloadCallCount = 0;

    // Exec
    for (const t of Object.values(execTrackers)) t.reset();
    execExitCode = 0;
    execStdout = "dagger v0.15.0";
    execStderr = "";
    execShouldFail = false;
}
