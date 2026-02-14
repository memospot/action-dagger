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
 * @param volumeName - Name of the Docker volume to backup
 * @param archivePath - Path where the archive will be saved
 * @param options - Backup options including verbose mode and compression level (0 = plain tar, 1-19 = zstd level)
 */
export async function backupEngineVolume(
    volumeName: string,
    archivePath: string,
    options?: { verbose?: boolean; compressionLevel?: number }
): Promise<void> {
    const isVerbose = options?.verbose ?? false;
    const compressionLevel = options?.compressionLevel ?? 0;

    // Check if volume exists
    try {
        await exec.exec("docker", ["volume", "inspect", volumeName], { silent: true });
    } catch {
        throw new Error(`Volume ${volumeName} does not exist`);
    }

    if (compressionLevel === 0) {
        // Fast mode: plain tar, let @actions/cache handle compression
        core.info(
            `Backing up volume to plain tar archive (compression level 0 - fastest mode)`
        );

        const cmd = `set -o pipefail && docker run --rm -v ${volumeName}:/data alpine tar -C /data -cf - . > ${archivePath}`;
        core.info(
            `Running backup command: docker run --rm -v ${volumeName}:/data alpine tar -C /data -cf - . > ${archivePath}`
        );

        let stderr = "";
        try {
            await exec.exec("bash", ["-c", cmd], {
                silent: !isVerbose,
                listeners: {
                    stderr: (data: Buffer) => {
                        stderr += data.toString();
                    },
                },
            });
        } catch (error) {
            const errorMsg = stderr ? `Error output: ${stderr}` : "";
            throw new Error(`Backup command failed: ${error}. ${errorMsg}`);
        }
    } else {
        // Compressed mode: tar + zstd with specified level
        core.info(`Backing up volume with zstd compression level ${compressionLevel}`);

        // Check if zstd is available
        try {
            await exec.exec("which", ["zstd"], { silent: true });
        } catch {
            throw new Error("zstd is not installed on this runner");
        }

        const cmd = `set -o pipefail && docker run --rm -v ${volumeName}:/data alpine tar -C /data -cf - . | zstd -T0 -${compressionLevel} -o ${archivePath}`;
        core.info(
            `Running backup command: docker run --rm -v ${volumeName}:/data alpine tar -C /data -cf - . | zstd -T0 -${compressionLevel} -o ${archivePath}`
        );

        let stderr = "";
        try {
            await exec.exec("bash", ["-c", cmd], {
                silent: !isVerbose,
                listeners: {
                    stderr: (data: Buffer) => {
                        stderr += data.toString();
                    },
                },
            });
        } catch (error) {
            const errorMsg = stderr ? `Error output: ${stderr}` : "";
            throw new Error(`Backup command failed: ${error}. ${errorMsg}`);
        }
    }
}

/**
 * Restore the engine volume from a tarball
 * Auto-detects compression format from file extension (.tar.zst = zstd, .tar = plain)
 * @param volumeName - Name of the Docker volume to restore to
 * @param archivePath - Path to the archive file
 */
export async function restoreEngineVolume(
    volumeName: string,
    archivePath: string
): Promise<void> {
    // Ensure volume exists
    await exec.exec("docker", ["volume", "create", volumeName], { silent: true });

    // Auto-detect format from file extension
    const isZstdCompressed = archivePath.endsWith(".tar.zst");

    if (isZstdCompressed) {
        // zstd compressed archive
        core.info(`Restoring from zstd compressed archive: ${archivePath}`);
        const cmd = `zstd -d -c ${archivePath} | docker run --rm -i -v ${volumeName}:/data alpine tar -C /data -xf -`;
        await exec.exec("sh", ["-c", cmd], { silent: true });
    } else {
        // Plain tar archive
        core.info(`Restoring from plain tar archive: ${archivePath}`);
        const cmd = `docker run --rm -i -v ${volumeName}:/data -v ${archivePath}:/archive.tar alpine tar -C /data -xf /archive.tar`;
        await exec.exec("sh", ["-c", cmd], { silent: true });
    }
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
