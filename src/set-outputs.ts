import * as core from "@actions/core";
import type { ActionOutputs } from "./types.js";

/**
 * Set action outputs.
 */
export function setOutputs(outputs: ActionOutputs): void {
    core.setOutput("dagger-version", outputs.daggerVersion);
    core.setOutput("cache-hit", outputs.cacheHit.toString());
    core.setOutput("binary-path", outputs.binaryPath);
    core.setOutput("output", outputs.output);
    core.setOutput("traceURL", outputs.traceURL);
}
