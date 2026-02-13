import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * Find the Dagger Engine container ID
 */
export async function findEngineContainer(): Promise<string | null> {
    try {
        const { stdout } = await exec.getExecOutput(
            "docker",
            ["ps", "-a", "--filter", "name=dagger-engine.dev", "--format", "{{.ID}}"],
            { silent: true }
        );
        const lines = stdout.trim().split("\n");
        return lines[0]?.trim() || null;
    } catch (error) {
        core.debug(`Failed to find engine container: ${error}`);
        return null;
    }
}

/**
 * Stop the Dagger Engine container
 */
export async function stopEngine(containerId: string): Promise<boolean> {
    try {
        await exec.exec("docker", ["stop", containerId], { silent: true });
        // Remove the container after stopping to avoid conflicts on next run
        await exec.exec("docker", ["rm", containerId], { silent: true });
        return true;
    } catch (error) {
        core.warning(`Failed to stop engine container: ${error}`);
        return false;
    }
}

/**
 * Backup the engine volume to a tarball
 */
export async function backupEngineVolume(
    volumeName: string,
    archivePath: string,
    options?: { verbose?: boolean }
): Promise<void> {
    // We use a helper alpine container to mount the volume and tar it
    // effectively: tar -cf /backup/cache.tar -C /data .
    const backupDir = parseDir(archivePath);
    const backupFile = parseFile(archivePath);

    const isVerbose = options?.verbose ?? false;

    const args = [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/data`,
        "-v",
        `${backupDir}:/backup`,
        "alpine",
        "tar",
        ...(isVerbose
            ? ["cvf", `--backup/${backupFile}`, "--totals", "-C", "/data", "."]
            : ["cf", `/backup/${backupFile}`, "-C", "/data", "."]),
    ];

    await exec.exec("docker", args, { silent: !isVerbose });
}

/**
 * Restore the engine volume from a tarball
 */
export async function restoreEngineVolume(
    volumeName: string,
    archivePath: string
): Promise<void> {
    // Ensure volume exists
    await exec.exec("docker", ["volume", "create", volumeName], { silent: true });

    const backupDir = parseDir(archivePath);
    const backupFile = parseFile(archivePath);

    const args = [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/data`,
        "-v",
        `${backupDir}:/backup`,
        "alpine",
        "tar",
        "xf",
        `/backup/${backupFile}`,
        "-C",
        "/data",
    ];

    await exec.exec("docker", args, { silent: true });
}

/**
 * Start the Dagger Engine with the mounted volume
 */
export async function startEngine(volumeName: string, version = "latest"): Promise<void> {
    // Remove any existing container with the same name to avoid conflicts
    try {
        await exec.exec("docker", ["rm", "-f", "dagger-engine.dev"], { silent: true });
    } catch {
        // Ignore errors - container might not exist
    }

    // We start the engine manually, pointing to our restored volume
    // We bind local docker socket so the engine can spawn containers
    const image = `registry.dagger.io/engine:${version}`;
    const args = [
        "run",
        "-d",
        "--name",
        "dagger-engine.dev",
        "-v",
        `${volumeName}:/var/lib/dagger`,
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock",
        "--privileged",
        image,
        "--addr",
        "unix:///var/run/buildkit/buildkitd.sock",
    ];

    await exec.exec("docker", args, { silent: true });
}

// Helpers
function parseDir(pathStr: string): string {
    const lastSlash = pathStr.lastIndexOf("/");
    return lastSlash === -1 ? "." : pathStr.substring(0, lastSlash);
}

function parseFile(pathStr: string): string {
    const lastSlash = pathStr.lastIndexOf("/");
    return lastSlash === -1 ? pathStr : pathStr.substring(lastSlash + 1);
}
