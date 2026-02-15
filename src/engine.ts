import * as fs from "node:fs";
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
 * Uses `docker rm -f` for immediate termination instead of graceful shutdown
 */
export async function stopEngine(containerId: string): Promise<boolean> {
    const startTime = Date.now();
    core.debug(`lifecycle:engine:stop:start container=${containerId}`);

    try {
        // Use rm -f to forcefully remove the container immediately
        // This avoids the 10-second graceful shutdown timeout of `docker stop`
        await exec.exec("docker", ["rm", "-f", containerId], { silent: true });
        const duration = Date.now() - startTime;
        core.debug(`lifecycle:engine:stop:end duration=${duration}ms`);
        return true;
    } catch (error) {
        // Check if the container is already gone (non-fatal)
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("No such container")) {
            core.warning(`Engine container ${containerId} already removed`);
            const duration = Date.now() - startTime;
            core.debug(`lifecycle:engine:stop:end duration=${duration}ms`);
            return true;
        }

        core.warning(`Failed to stop engine container: ${error}`);
        core.debug(`lifecycle:engine:stop:end error=true`);
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
    const startTime = Date.now();
    const isVerbose = options?.verbose ?? false;
    const compressionLevel = options?.compressionLevel ?? 0;

    core.debug(
        `lifecycle:backup:start volume=${volumeName} compressionLevel=${compressionLevel}`
    );

    // Track if backup was cancelled
    let isCancelled = false;

    // Set up signal handler for cancellation
    const signalHandler = () => {
        isCancelled = true;
        core.debug("lifecycle:backup:cancelled signal=SIGINT");
    };
    process.once("SIGINT", signalHandler);
    process.once("SIGTERM", signalHandler);

    // Cleanup function to remove partial archive
    const cleanup = () => {
        if (fs.existsSync(archivePath)) {
            try {
                fs.unlinkSync(archivePath);
                core.debug("lifecycle:backup:cancelled partialArchiveRemoved=true");
            } catch (cleanupError) {
                core.debug(`Failed to remove partial archive: ${cleanupError}`);
            }
        }
    };

    try {
        // Check if volume exists
        try {
            await exec.exec("docker", ["volume", "inspect", volumeName], { silent: true });
        } catch {
            throw new Error(`Volume ${volumeName} does not exist`);
        }

        // Check for cancellation before starting backup
        if (isCancelled) {
            core.info("Backup cancelled before starting");
            return;
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
                // Check if this was due to cancellation
                if (isCancelled) {
                    core.info("Backup interrupted by cancellation signal");
                    return;
                }
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

            // Check for cancellation before running backup
            if (isCancelled) {
                core.info("Backup cancelled before starting");
                return;
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
                // Check if this was due to cancellation
                if (isCancelled) {
                    core.info("Backup interrupted by cancellation signal");
                    return;
                }
                const errorMsg = stderr ? `Error output: ${stderr}` : "";
                throw new Error(`Backup command failed: ${error}. ${errorMsg}`);
            }
        }

        const duration = Date.now() - startTime;
        core.debug(`lifecycle:backup:end duration=${duration}ms`);
    } catch (error) {
        const duration = Date.now() - startTime;
        core.debug(`lifecycle:backup:end duration=${duration}ms error=true`);
        throw error;
    } finally {
        // Always remove signal handlers
        process.off("SIGINT", signalHandler);
        process.off("SIGTERM", signalHandler);

        // Cleanup partial archive if cancelled
        if (isCancelled) {
            cleanup();
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
 * Get the size of a Docker volume in bytes
 * Returns 0 if the volume doesn't exist or size cannot be determined
 */
export async function getVolumeSize(volumeName: string): Promise<number> {
    try {
        // Check if volume exists first
        await exec.exec("docker", ["volume", "inspect", volumeName], { silent: true });

        // Use du to get the size of the volume data
        // Docker volumes are stored in /var/lib/docker/volumes/{name}/_data
        const { stdout } = await exec.getExecOutput(
            "docker",
            ["run", "--rm", "-v", `${volumeName}:/data:ro`, "alpine", "du", "-sb", "/data"],
            { silent: true }
        );

        const match = stdout.trim().match(/^(\d+)\s+/);
        if (match) {
            return parseInt(match[1], 10);
        }
        return 0;
    } catch (error) {
        core.debug(`Failed to get volume size: ${error}`);
        return 0;
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
