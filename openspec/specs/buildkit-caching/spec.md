# BuildKit Caching Strategy

## Purpose

Optimize CI performance by persisting the BuildKit engine state (Dagger volumes) across workflow runs, rather than relying on `type=local` exports which can be slow and problematic in certain environments.

## Requirements

### REQ-1: Engine Volume Persistence

The action MUST persist the Dagger Engine's state volume (`dagger-engine-vol`) between runs.

- **Backup**:
  - Stop the running engine container to ensure data consistency.
  - Export the volume contents to a tarball archive.
  - Upload the archive to GitHub Actions cache.

- **Restore**:
  - Download the archive from GitHub Actions cache.
  - Create the `dagger-engine-vol` volume if it doesn't exist.
  - Extract the archive contents into the volume.
  - Start the Dagger Engine container mounting this hydrated volume.

### REQ-2: Cache Key Strategy

The cache key strategy MUST support "rolling" updates to ensure fresh cache layers are saved on every run.

#### Scenario: Default Key Format

- The action MUST generate a default cache key if `cache-key` input is not provided.
- Format: `dagger-v1-{os}-{arch}-{run_id}`
- Restore Key: `dagger-v1-{os}-{arch}-` (derived by removing the last segment)

#### Scenario: Custom Key Input

- The action MUST accept an optional `cache-key` input.
- If provided, this EXACT key is used for saving the cache.
- The Restore Key is derived by removing the last hyphen-delimited segment.
- Example: `my-key-123` -> Restore: `my-key`

#### Scenario: Cache Version

- The `cache-version` input is REMOVED.
- Versioning is handled implicitly by the key prefix (default `dagger-v1`).

### REQ-3: Engine Lifecycle Management

The action MUST manage the Dagger Engine container lifecycle to facilitate caching.

- **Start**: Explicitly start the engine container with volume mounts before running Dagger commands.
- **Stop**: Explicitly stop and remove the engine container before backing up to ensure no file locks or corruption.
- **Find**: Ability to identify the correct engine container (`dagger-engine.dev`).

### REQ-4: Disable Legacy Caching

The action MUST disable the previous `type=local` caching mechanism when this new strategy is active to avoid redundant work and conflicts.
- Environment variables for `DAGGER_CACHE_TO`/`FROM` should NOT be set.

## Acceptance Criteria

1. Given a warm cache exists
   When the action runs
   Then the engine volume is restored from the tarball
   And the engine starts with the restored data

2. Given no cache exists
   When the action runs
   Then a fresh engine volume is created
   And the engine starts empty

3. Given the action completes successfully
   When the post-run step executes
   Then the engine is stopped
   And the volume is backed up to GitHub Actions cache
