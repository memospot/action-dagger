/**
 * Check if the given uid represents the root user.
 */
export function isRoot(uid: number | undefined): boolean {
    return uid === 0;
}

/**
 * Check if the current process should use sudo.
 * Returns false if running as root (uid 0), true otherwise.
 */
export function shouldUseSudo(): boolean {
    return !isRoot(process.getuid?.());
}

/**
 * Get the path to the Docker socket
 * Checks DOCKER_HOST environment variable first, falls back to /var/run/docker.sock
 */
export function getDockerSocketPath(): string {
    const dockerHost = process.env.DOCKER_HOST;
    if (dockerHost?.startsWith("unix://")) {
        // Extract path from unix://<path>
        return dockerHost.replace("unix://", "");
    }

    // Default fallback
    return "/var/run/docker.sock";
}
