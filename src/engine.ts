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
 * Backup the engine volume to a tarball using zstd streaming
 */
export async function backupEngineVolume(
    volumeName: string,
    archivePath: string,
    options?: { verbose?: boolean }
): Promise<void> {
    const isVerbose = options?.verbose ?? false;

    // Check if volume exists
    try {
        await exec.exec("docker", ["volume", "inspect", volumeName], { silent: true });
    } catch {
        throw new Error(`Volume ${volumeName} does not exist`);
    }

    // Check if zstd is available
    try {
        await exec.exec("which", ["zstd"], { silent: true });
    } catch {
        throw new Error("zstd is not installed on this runner");
    }

    // docker run --rm -v vol:/data alpine tar -C /data -cf - . | zstd -T0 -3 -o archivePath
    const cmd = `docker run --rm -v ${volumeName}:/data alpine tar -C /data -cf - . | zstd -T0 -3 -o ${archivePath}`;

    core.info(`Running backup command: ${cmd}`);

    try {
        await exec.exec("sh", ["-c", cmd], { silent: !isVerbose });
    } catch (error) {
        throw new Error(`Backup command failed: ${error}`);
    }
}

/**
 * Restore the engine volume from a zstd compressed tarball
 */
export async function restoreEngineVolume(
    volumeName: string,
    archivePath: string
): Promise<void> {
    // Ensure volume exists
    await exec.exec("docker", ["volume", "create", volumeName], { silent: true });

    // zstd -d -c archivePath | docker run -i -v vol:/data alpine tar -C /data -xf -
    // Note: -i is crucial for docker run to accept stdin
    const cmd = `zstd -d -c ${archivePath} | docker run --rm -i -v ${volumeName}:/data alpine tar -C /data -xf -`;

    await exec.exec("sh", ["-c", cmd], { silent: true });
}

/**
 * Delete the engine volume
 */
export async function deleteEngineVolume(volumeName: string): Promise<void> {
    try {
        await exec.exec("docker", ["volume", "rm", volumeName], { silent: true });
    } catch (error) {
        core.warning(`Failed to delete engine volume: ${error}`);
    }
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
