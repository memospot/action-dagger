# Specification: cache-mode-config

## Overview

The cache-mode-config capability allows users to explicitly control which caching method is used for persisting the Dagger engine state. This enables testing of specific modes and provides explicit control over caching behavior.

## Requirements

### Requirement: Cache mode input accepts valid values

The system SHALL accept a `cache-mode` input with values: `direct`, `container`, or `auto`.

#### Scenario: Valid direct mode

- **WHEN** user provides `cache-mode: direct`
- **THEN** the system SHALL use only direct volume mount caching
- **AND** the system SHALL NOT fall back to container mode on failure

#### Scenario: Valid container mode

- **WHEN** user provides `cache-mode: container`
- **THEN** the system SHALL use only container-based tar backup caching
- **AND** the system SHALL NOT attempt direct volume mount caching

#### Scenario: Valid auto mode (default)

- **WHEN** user provides `cache-mode: auto` or no value
- **THEN** the system SHALL attempt direct volume mount caching first
- **AND** the system SHALL fall back to container mode if direct fails

### Requirement: Cache mode validation

The system SHALL validate the cache-mode input and default to `auto` for invalid values.

#### Scenario: Invalid cache mode value

- **WHEN** user provides `cache-mode: invalid-value`
- **THEN** the system SHALL emit a warning
- **AND** the system SHALL default to `auto` mode

#### Scenario: Empty cache mode

- **WHEN** user provides empty `cache-mode`
- **THEN** the system SHALL use `auto` mode

### Requirement: Direct mode behavior

The system SHALL perform direct volume mount operations when `cache-mode: direct` is specified.

#### Scenario: Direct cache save

- **WHEN** cache-mode is `direct`
- **AND** the save operation is triggered
- **THEN** the system SHALL mount the volume directly to the cache directory
- **AND** the system SHALL save cache using @actions/cache
- **AND** if the operation fails, the system SHALL emit a warning and continue

#### Scenario: Direct cache restore

- **WHEN** cache-mode is `direct`
- **AND** the restore operation is triggered
- **THEN** the system SHALL mount the volume directly to the cache directory
- **AND** the system SHALL restore cache using @actions/cache
- **AND** if the operation fails, the system SHALL emit a warning and continue

### Requirement: Container mode behavior

The system SHALL perform container-based tar backup when `cache-mode: container` is specified.

#### Scenario: Container cache save

- **WHEN** cache-mode is `container`
- **AND** the save operation is triggered
- **THEN** the system SHALL create a tarball using busybox container
- **AND** the system SHALL save the tarball directory using @actions/cache
- **AND** if the operation fails, the system SHALL emit a warning and continue

#### Scenario: Container cache restore

- **WHEN** cache-mode is `container`
- **AND** the restore operation is triggered
- **THEN** the system SHALL restore the tarball directory using @actions/cache
- **AND** the system SHALL extract the tarball into the volume using busybox container
- **AND** if the operation fails, the system SHALL emit a warning and continue

### Requirement: Soft-fail error handling

All cache operations SHALL soft-fail - emitting warnings but never blocking action execution.

#### Scenario: Direct mode save failure

- **WHEN** cache-mode is `direct`
- **AND** the direct save operation fails
- **THEN** the system SHALL emit a warning with the error
- **AND** the system SHALL continue execution
- **AND** the action SHALL NOT fail

#### Scenario: Container mode restore failure

- **WHEN** cache-mode is `container`
- **AND** the container restore operation fails
- **THEN** the system SHALL emit a warning with the error
- **AND** the system SHALL continue with fresh engine volume
- **AND** the action SHALL NOT fail

### Requirement: Mode persistence across steps

The system SHALL persist the cache mode selection from the main step to the post step.

#### Scenario: Mode saved to state

- **WHEN** cache-mode is specified in main step
- **THEN** the system SHALL save the mode to GitHub Actions state
- **AND** the post step SHALL read the mode from state
- **AND** the post step SHALL use the same mode for cache save
