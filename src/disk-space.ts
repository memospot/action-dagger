import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * Check available disk space on the path where cache is stored.
 * Returns the available space in bytes.
 */
export async function getAvailableDiskSpace(pathToCheck: string): Promise<number> {
    try {
        const { stdout } = await exec.getExecOutput(
            "df",
            ["-B1", "--output=avail", pathToCheck],
            {
                silent: true,
            }
        );
        const lines = stdout.trim().split("\n");
        // Second line contains the value (first is header)
        const availableStr = lines[1]?.trim();
        if (!availableStr) {
            core.warning(`Failed to parse df output: ${stdout}`);
            return 0;
        }
        const available = parseInt(availableStr, 10);
        if (Number.isNaN(available)) {
            core.warning(`Failed to parse available space as number: ${availableStr}`);
            return 0;
        }
        return available;
    } catch (error) {
        core.warning(`Failed to check disk space: ${error}`);
        // Return 0 so we can fallback to skipping safe strategies if we can't check
        return 0;
    }
}
