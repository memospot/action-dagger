# disk-space-guardrails Specification

## Purpose

TBD - created by archiving change disk-space-guardrails. Update Purpose after archive.

## Requirements

### Requirement: Disk Space Guard

The system SHALL check available disk space on the runner before attempting a cache backup.

#### Scenario: Sufficient Space

- **WHEN** the estimated backup size (current volume size / 3.5) is less than available runner disk space (with a safety margin of 2GB)
- **THEN** the backup process proceeds normally

#### Scenario: Insufficient Space

- **WHEN** the estimated backup size exceeds available disk space
- **THEN** a warning is logged to the console
- **AND** the backup process proceeds (soft fail mode) - it might fail later but we don't block upfront, just warn

### Requirement: Streamed Compression

The system SHALL use `zstd` compression and stream the backup directly to the runner file system to minimize peak disk usage.

#### Scenario: Backup Execution

- **WHEN** the backup is initiated
- **THEN** the engine volume is streamed through `tar` and `zstd` (pipe)
- **AND** the output is written directly to the `dagger-engine-state.tar.zst` file on the runner
- **AND** no intermediate uncompressed tarball is created

### Requirement: Volume Cleanup

The system SHALL remove the engine volume after a successful backup to free up space for the cache upload.

#### Scenario: Post-Backup Cleanup

- **WHEN** the backup archive is successfully created
- **THEN** the Dagger Engine volume is removed/pruned
- **AND** the disk space is reclaimed

### Requirement: Cache Archive Format

The cache archive format SHALL be updated to use `zstd` compression for better performance and storage efficiency.

#### Scenario: Archive Creation

- **WHEN** the cache archive is created
- **THEN** it SHALL use the `.tar.zst` extension
- **AND** it SHALL be compressed using `zstd`
