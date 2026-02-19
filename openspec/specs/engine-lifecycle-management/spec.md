# engine-lifecycle-management Specification

## Purpose

TBD - created by archiving change investigate-post-performance. Update Purpose after archive.

## Requirements

### Requirement: Immediate Engine Termination

The system SHALL support immediate termination of the Dagger Engine container to minimize shutdown delays.

#### Scenario: Clean execution

- **WHEN** the action completes successfully
- **AND** engine teardown is requested
- **THEN** the engine container SHALL be forcibly removed (`docker rm -f`)
- **AND** no graceful shutdown wait period SHALL occur

#### Scenario: Workflow Cancellation

- **WHEN** the workflow is cancelled by the user
- **THEN** the engine container SHALL be forcibly removed immediately
- **AND** the action process SHALL exit without delay

### Requirement: Signal Propagation

The system SHALL correctly propagate termination signals (SIGINT, SIGTERM) to underlying Docker processes.

#### Scenario: Backup Interruption

- **WHEN** a backup operation is in progress
- **AND** a cancellation signal is received
- **THEN** the backup process (docker run) SHALL be terminated immediately
- **AND** the archive file SHALL be cleaned up

### Requirement: Lifecycle Logging

The system SHALL log timing information for key lifecycle events to aid performance debugging.

#### Scenario: Lifecycle events

- **WHEN** engine is started, stopped, or backed up
- **THEN** start and end times or duration SHALL be logged to debug output
- **AND** logs SHALL follow format: `lifecycle:[action]:[event] [metadata]`
  - Example start: `lifecycle:engine:stop:start container=dagger-engine-abc`
  - Example end: `lifecycle:engine:stop:end duration=15ms`
  - Example cancel: `lifecycle:backup:cancelled partialArchiveRemoved=true`

### Requirement: Error Handling

The system SHALL handle Docker command failures gracefully without crashing the post-action step.

#### Scenario: Missing container

- **WHEN** `docker rm -f` is executed
- **AND** the container does not exist
- **THEN** a warning SHALL be logged
- **AND** execution SHALL continue normally

#### Scenario: Permission failure

- **WHEN** Docker commands fail due to permissions
- **THEN** the error SHALL be logged
- **AND** the backup operation SHALL still be attempted
