// ... (imports remain)
import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { getDockerSocketPath, shouldUseSudo } from "./docker";
import { OperationCancelledError } from "./operation-cancelled-error";
import { withTimeout } from "./timeout";

const DAGGER_PULL_TIMEOUT_MS = 120_000;

/**
 * Generate a unique container name for cache helper containers
 * Uses timestamp and random suffix to avoid collisions
 */
export function generateUniqueContainerName(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${timestamp}-${random}`;
}

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

// --- Leaf Helpers for backupEngineVolume ---

/**
 * Verify if a docker volume exists
 */
export async function verifyVolumeExists(volumeName: string): Promise<void> {
    try {
        await exec.exec("docker", ["volume", "inspect", volumeName], { silent: true });
    } catch {
        throw new Error(`Volume ${volumeName} does not exist`);
    }
}

/**
 * Convert NodeJS signals to a cancelled flag and cleanup callback
 */
export function setupBackupSignalHandlers(onCancel: () => void): () => void {
    const signalHandler = () => {
        core.debug("lifecycle:backup:cancelled signal=SIGINT/SIGTERM");
        onCancel();
    };
    process.once("SIGINT", signalHandler);
    process.once("SIGTERM", signalHandler);

    return () => {
        process.off("SIGINT", signalHandler);
        process.off("SIGTERM", signalHandler);
    };
}

/**
 * Setup abort signal handler for backup cancellation.
 */
export function setupBackupAbortHandler(
    abortSignal: AbortSignal | undefined,
    onCancel: () => void
): () => void {
    if (!abortSignal) {
        return () => {};
    }

    if (abortSignal.aborted) {
        onCancel();
        return () => {};
    }

    const abortHandler = () => {
        core.debug("lifecycle:backup:cancelled signal=ABORT");
        onCancel();
    };

    abortSignal.addEventListener("abort", abortHandler, { once: true });
    return () => {
        abortSignal.removeEventListener("abort", abortHandler);
    };
}

/**
 * Cleanup specific backup archive path
 */
export function cleanupBackupArchive(archivePath: string): void {
    if (fs.existsSync(archivePath)) {
        try {
            fs.unlinkSync(archivePath);
            core.debug("lifecycle:backup:cancelled partialArchiveRemoved=true");
        } catch (cleanupError) {
            core.debug(`Failed to remove partial archive: ${cleanupError}`);
        }
    }
}

/**
 * Construct docker run arguments for backup
 */
export function constructBackupArgs(
    volumeName: string,
    archivePath: string,
    helperContainerName: string
): string[] {
    const archiveDir = path.dirname(archivePath);
    const archiveName = path.basename(archivePath);

    return [
        "run",
        "--name",
        helperContainerName,
        "--rm",
        "-v",
        `${volumeName}:/data:ro`,
        "-v",
        `${archiveDir}:/out`,
        "busybox",
        "tar",
        "-C",
        "/data",
        "-cf",
        `/out/${archiveName}`,
        ".",
    ];
}

/**
 * Force-remove backup helper container.
 */
export async function stopBackupHelperContainer(helperContainerName: string): Promise<void> {
    try {
        await exec.exec("docker", ["rm", "-f", helperContainerName], { silent: true });
    } catch (error) {
        core.debug(`Backup helper container stop ignored: ${error}`);
    }
}

/**
 * Backup the engine volume to a tarball
 * @param volumeName - Name of the Docker volume to backup
 * @param archivePath - Path where the archive will be saved
 * @param options - Backup options including verbose mode
 */
export async function backupEngineVolume(
    volumeName: string,
    archivePath: string,
    options?: { verbose?: boolean; abortSignal?: AbortSignal }
): Promise<void> {
    const startTime = Date.now();
    const isVerbose = options?.verbose ?? false;

    core.debug(`lifecycle:backup:start volume=${volumeName}`);

    let isCancelled = false;
    const helperContainerName = generateUniqueContainerName("dagger-cache-backup");
    const onCancel = () => {
        isCancelled = true;
        void stopBackupHelperContainer(helperContainerName);
    };

    const removeSignalHandlers = setupBackupSignalHandlers(onCancel);
    const removeAbortHandler = setupBackupAbortHandler(options?.abortSignal, onCancel);

    try {
        await verifyVolumeExists(volumeName);

        // Check for cancellation before starting backup
        if (isCancelled) {
            throw new OperationCancelledError("Backup cancelled before starting");
        }

        core.info(`Backing up volume to plain tar archive`);

        const args = constructBackupArgs(volumeName, archivePath, helperContainerName);
        core.info(`Running backup command: docker ${args.join(" ")}`);

        try {
            await exec.exec("docker", args, {
                silent: !isVerbose,
            });
        } catch (error) {
            // Check if this was due to cancellation
            if (isCancelled) {
                throw new OperationCancelledError("Backup interrupted by cancellation signal");
            }
            throw new Error(`Backup command failed: ${error}`);
        }

        const duration = Date.now() - startTime;
        core.debug(`lifecycle:backup:end duration=${duration}ms`);
    } catch (error) {
        const duration = Date.now() - startTime;
        core.debug(`lifecycle:backup:end duration=${duration}ms error=true`);
        throw error;
    } finally {
        removeSignalHandlers();
        removeAbortHandler();

        // Cleanup partial archive if cancelled
        if (isCancelled) {
            cleanupBackupArchive(archivePath);
        }
    }
}

/**
 * Restore the engine volume from a tarball
 * @param volumeName - Name of the Docker volume to restore to
 * @param archivePath - Path to the archive file
 */
export async function restoreEngineVolume(
    volumeName: string,
    archivePath: string
): Promise<void> {
    // Ensure volume exists
    await exec.exec("docker", ["volume", "create", volumeName], { silent: true });

    // Plain tar archive
    core.info(`Restoring from plain tar archive: ${archivePath}`);
    const cmd = `docker run --rm -i -v ${volumeName}:/data -v ${archivePath}:/archive.tar busybox tar -C /data -xf /archive.tar`;
    await exec.exec("sh", ["-c", cmd], { silent: true });
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
            ["run", "--rm", "-v", `${volumeName}:/data:ro`, "busybox", "du", "-sb", "/data"],
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
 * Clear (empty) the engine volume contents without deleting the volume itself
 * This is faster than deleting and recreating the volume, and frees disk space
 */
export async function clearEngineVolume(volumeName: string): Promise<void> {
    try {
        // Check if volume exists
        try {
            await exec.exec("docker", ["volume", "inspect", volumeName], { silent: true });
        } catch {
            core.debug(`Volume ${volumeName} does not exist, nothing to clear`);
            return;
        }

        // Clear volume contents using busybox rm -rf
        // This preserves the volume but removes all data inside it
        await exec.exec(
            "docker",
            [
                "run",
                "--rm",
                "-v",
                `${volumeName}:/data`,
                "busybox",
                "sh",
                "-c",
                "rm -rf /data/* /data/.*[!.] 2>/dev/null || true",
            ],
            { silent: true }
        );
    } catch (error) {
        core.warning(`Failed to clear engine volume contents: ${error}`);
        throw error;
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
 * Get the host path for a Docker volume
 * Note: Only works on Linux hosts where Docker is running natively
 */
export async function getVolumeMountpoint(volumeName: string): Promise<string> {
    try {
        const { stdout } = await exec.getExecOutput(
            "docker",
            ["volume", "inspect", "--format", "{{.Mountpoint}}", volumeName],
            { silent: true }
        );
        return stdout.trim();
    } catch (error) {
        throw new Error(`Failed to inspect volume ${volumeName}: ${error}`);
    }
}

// --- Leaf Helpers for mountVolume ---

/**
 * Execute bind mount command
 */
export async function mountBind(
    mountpoint: string,
    targetDir: string,
    useSudo: boolean
): Promise<void> {
    const cmdMount = ["mount", "--bind", mountpoint, targetDir];
    if (useSudo) {
        cmdMount.unshift("sudo");
    }
    await exec.exec(cmdMount[0], cmdMount.slice(1), { silent: true });
}

/**
 * Adjust ownership and permissions of mounted volume
 */
export async function adjustVolumePermissions(
    targetDir: string,
    useSudo: boolean
): Promise<void> {
    const uid = process.getuid ? process.getuid() : 0;
    const gid = process.getgid ? process.getgid() : 0;

    // Adjust ownership
    const cmdChown = ["chown", "-R", `${uid}:${gid}`, targetDir];
    if (useSudo) {
        cmdChown.unshift("sudo");
    }
    await exec.exec(cmdChown[0], cmdChown.slice(1), { silent: true });

    // Ensure read+execute permissions for the owner
    const cmdChmod = ["chmod", "-R", "u+rX", targetDir];
    if (useSudo) {
        cmdChmod.unshift("sudo");
    }
    await exec.exec(cmdChmod[0], cmdChmod.slice(1), { silent: true });
}

/**
 * Mount a Docker volume to a host directory using sudo mount --bind
 * This allows direct access to volume data without copying
 */
export async function mountVolume(volumeName: string, targetDir: string): Promise<void> {
    core.info(`Mounting volume ${volumeName} to ${targetDir}…`);

    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    try {
        const mountpoint = await getVolumeMountpoint(volumeName);
        const useSudo = shouldUseSudo();

        // 1. Mount the volume directory to the target directory
        await mountBind(mountpoint, targetDir, useSudo);

        // 2 & 3. Adjust ownership and permissions
        // This allows access to files
        await adjustVolumePermissions(targetDir, useSudo);

        core.info(`Volume mounted and permissions adjusted at ${targetDir}`);
    } catch (error) {
        throw new Error(`Failed to mount volume: ${error}`);
    }
}

/**
 * Unmount a volume from a host directory
 */
export async function unmountVolume(targetDir: string): Promise<void> {
    try {
        // Check if mounted first to avoid errors
        const { exitCode } = await exec.getExecOutput("mountpoint", ["-q", targetDir], {
            ignoreReturnCode: true,
            silent: true,
        });

        if (exitCode === 0) {
            const useSudo = shouldUseSudo();
            const cmdUmount = ["umount", targetDir];
            if (useSudo) {
                cmdUmount.unshift("sudo");
            }
            await exec.exec(cmdUmount[0], cmdUmount.slice(1), { silent: true });
            core.debug(`Unmounted ${targetDir}`);
        }
    } catch (error) {
        core.warning(`Failed to unmount ${targetDir}: ${error}`);
    }
}

/**
 * Pull the Dagger Engine image in background.
 *
 * Returns a Promise that resolves when pull completes or fails.
 */
export function pullDaggerImage(version: string): Promise<void> {
    const image = `registry.dagger.io/engine:${version}`;
    core.debug(`Starting background pull for Dagger image: ${image}`);
    return withTimeout(
        exec.exec("timeout", ["120s", "docker", "pull", image], {
            silent: true,
            ignoreReturnCode: true,
        }),
        DAGGER_PULL_TIMEOUT_MS,
        "Background Dagger image pull"
    )
        .then(() => undefined)
        .catch((error) => {
            core.debug(
                `Background Dagger image pull skipped/timed out (non-critical): ${error}`
            );
        });
}

/**
 * Start the Dagger Engine with the mounted volume
 */
export async function startEngine(
    volumeName: string,
    version = "latest",
    configPath?: string
): Promise<void> {
    // Remove any existing container with the same name to avoid conflicts, ignoring errors as the container may not exist.
    await exec.exec("docker", ["rm", "-f", "dagger-engine.dev"], { silent: true }).catch();

    // We start the engine manually, pointing to our restored volume
    // We bind local docker socket so the engine can spawn containers
    const hostSocket = getDockerSocketPath();
    const image = `registry.dagger.io/engine:${version}`;
    const args = [
        "run",
        "-d",
        "--name",
        "dagger-engine.dev",
        "-v",
        `${volumeName}:/var/lib/dagger`,
        "-v",
        `${hostSocket}:/var/run/docker.sock`,
        "--privileged",
    ];

    // Mount engine.toml config if provided
    if (configPath) {
        args.push("-v", `${configPath}:/etc/dagger/engine.toml:ro`);
    }

    args.push(image, "--addr", "unix:///var/run/buildkit/buildkitd.sock");

    await exec.exec("docker", args, { silent: true });
}
