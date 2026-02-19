# Capability: Direct Volume Backup

## Purpose

TBD

## Requirements

### Requirement: Direct Volume Backup

The system SHALL support backing up the BuildKit state volume directly to GitHub Actions cache without intermediate archiving as the primary method.

#### Scenario: Backup Execution

- **WHEN** post-action runs
- **THEN** the system SHALL attempt to save the BuildKit state volume directly using `@actions/cache`
- **AND** no user configuration for compression mode SHALL be required (automatic)

#### Scenario: Permission Handling

- **WHEN** backing up the volume
- **THEN** the system SHALL attempt to preserve or compatibly map file permissions
- **AND** if necessary permissions are missing, it SHALL modify them (e.g., ACLs or chown) to allow reading
- **AND** it SHALL restore original permissions if the volume is mounted back to the engine

### Requirement: Fallback Backup Capability

The system SHALL automatically fallback to alternative backup methods if direct backup fails.

#### Scenario: Fallback to Tarball

- **WHEN** direct volume backup fails (e.g. permission error, file lock)
- **THEN** the system SHALL create a standard tarball of the volume content
- **AND** save this tarball to the cache
- **AND** log a warning about the fallback

### Requirement: Volume Lifecycle Management

The system MUST manage the lifecycle of any helper resources used to expose the volume.

#### Scenario: Cleanup

- **WHEN** backup completes (success or failure)
- **THEN** any helper containers or temporary mounts SHALL be removed
