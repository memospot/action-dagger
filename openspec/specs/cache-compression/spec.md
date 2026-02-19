# Capability: Cache Compression

## Purpose

Allow users to configure the compression level for Dagger build cache archives, balancing between speed and storage efficiency.

## Requirements

### Requirement: Compression Level Input

The action MUST accept a `cache-compression` input with integer values -1 to 19.

#### Scenario: Input Validation

- **WHEN** user provides `cache-compression` input
- **THEN** it SHALL be parsed as an integer
- **AND** values outside -1 to 19 SHALL be clamped to the nearest valid value
- **AND** default value SHALL be 0 (fastest mode)

### Requirement: Compression Level -1 (Direct Mode)

When compression level is -1, the system MUST use direct volume backup.

#### Scenario: Direct Mode Activation

- **WHEN** compression level is -1
- **THEN** direct volume backup SHALL be activated
- **AND** no explicit compression (gzip/zstd) SHALL be performed by the action
- **AND** archive creation SHALL be skipped in favor of directory caching

### Requirement: Compression Level 0 (Fast Mode)

When compression level is 0, the system MUST create plain tar archives (.tar).

#### Scenario: Archive Creation

- **WHEN** compression level is 0
- **THEN** archive file SHALL have .tar extension
- **AND** no local compression SHALL be applied
- **AND** archive SHALL be suitable for @actions/cache to compress internally
- **AND** backup SHALL complete significantly faster than compressed modes

### Requirement: Compression Level 1-19 (Compressed Mode)

When compression level is 1-19, the system MUST create zstd compressed archives (.tar.zst).

#### Scenario: Archive Creation

- **WHEN** compression level is 1-19
- **THEN** archive file SHALL have .tar.zst extension
- **AND** zstd compression SHALL be applied with the specified level
- **AND** multi-threading SHALL be enabled (-T0 flag)

### Requirement: Format Auto-Detection on Restore

The system MUST automatically detect archive format during restore.

#### Scenario: Restore from .tar.zst

- **WHEN** restoring a file ending in .tar.zst
- **THEN** it SHALL be decompressed with zstd before extraction

#### Scenario: Restore from .tar

- **WHEN** restoring a file ending in .tar
- **THEN** it SHALL be extracted directly

### Requirement: Archive Cleanup

The system MUST clean up archive files after cache save operations.

#### Scenario: Successful Save

- **WHEN** cache save completes successfully
- **THEN** archive file SHALL be deleted

#### Scenario: Failed Save

- **WHEN** cache save fails or times out
- **THEN** archive file SHALL be deleted
- **AND** cleanup SHALL use try/finally pattern to guarantee execution

### Requirement: State Persistence

The system MUST persist compression level between main and post-action phases.

#### Scenario: State Transfer

- **WHEN** action runs
- **THEN** compression level SHALL be saved to GitHub Actions state
- **AND** post-action SHALL retrieve the same compression level used during setup
- **AND** fallback to input value SHALL occur if state is unavailable

## Non-Functional Requirements

### Backward Compatibility

Existing caches in .tar.zst format MUST remain restorable.

### Performance

Level 0 MUST complete backup at least 2x faster than Level 3 for typical engine volumes.

### Disk Space

No orphaned archive files MUST remain after workflow completion.
