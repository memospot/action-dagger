# Capability: Compatibility

## Purpose

Support execution in diverse CI/CD runner environments, including GitHub Actions, Gitea, Forgejo, and other self-hosted runner setups.

## Requirements

### Requirement: Rootless Execution

The action MUST run correctly whether the runner user is `root` or a non-privileged user.

#### Scenario: Running as root

- **WHEN** the action runs as `root` (UID 0)
- **THEN** the action MUST NOT use `sudo` for privileged operations

#### Scenario: Running as non-root

- **WHEN** the action runs as a non-root user
- **THEN** the action SHOULD use `sudo` for privileged operations (mounting, chown)

### Requirement: Docker Socket Resolution

The action MUST respect the `DOCKER_HOST` environment variable for locating the Docker engine socket.

#### Scenario: DOCKER_HOST with unix:// scheme

- **WHEN** `DOCKER_HOST` is set to a value starting with `unix://`
- **THEN** the action MUST extract and use the socket path

#### Scenario: DOCKER_HOST unset or invalid

- **WHEN** `DOCKER_HOST` is unset or uses an unsupported scheme (e.g., `tcp://`)
- **THEN** the action SHOULD fall back to `/var/run/docker.sock`
