import * as core from "@actions/core";
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
    /** Command stdout output */
    output: string;
    /** Dagger Cloud trace URL */
    traceURL: string;
}

/**
 * Set action outputs.
 */
export function setOutputs(outputs: ActionOutputs): void {
    core.setOutput("dagger-version", outputs.daggerVersion);
    core.setOutput("cache-hit", outputs.cacheHit.toString());
    core.setOutput("binary-path", outputs.binaryPath);
    core.setOutput("output", outputs.output);
    core.setOutput("trace-url", outputs.traceURL);
}
