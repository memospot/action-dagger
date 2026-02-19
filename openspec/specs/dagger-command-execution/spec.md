## ADDED Requirements

### Requirement: Assemble dagger commands from inputs

The system SHALL assemble dagger commands based on verb, args, call, and shell inputs.

#### Scenario: Simple verb + args

- **WHEN** verb="call" and args="version"
- **THEN** the command SHALL be "dagger --progress plain call version"

#### Scenario: Call input overrides verb

- **WHEN** call="hello" is provided
- **THEN** verb SHALL be "call" regardless of verb input
- **AND** args SHALL be "hello"

#### Scenario: Shell input bypasses verb

- **WHEN** shell="container from alpine" is provided
- **THEN** the command SHALL be the shell content directly
- **AND** verb SHALL be ignored

#### Scenario: Module flag included

- **WHEN** module="github.com/shykes/daggerverse/hello" is provided
- **THEN** the command SHALL include "-m github.com/shykes/daggerverse/hello"

#### Scenario: Dagger flags applied

- **WHEN** dagger-flags="--progress plain" is provided
- **THEN** flags SHALL be inserted after "dagger" and before verb

### Requirement: Execute dagger commands

The system SHALL execute assembled dagger commands with proper environment.

#### Scenario: Execute in working directory

- **WHEN** workdir="./my-app" is provided
- **THEN** the command SHALL execute in that directory
- **AND** not affect the global working directory

#### Scenario: Capture stdout and stderr

- **WHEN** executing a dagger command
- **THEN** stdout SHALL be captured
- **AND** stderr SHALL be captured separately

#### Scenario: Handle command failure

- **WHEN** dagger command exits with non-zero code
- **THEN** action SHALL fail with descriptive error
- **AND** captured output SHALL be available for debugging

#### Scenario: No execution when no command inputs

- **WHEN** verb="", args="", call="", shell=""
- **THEN** no dagger command SHALL be executed
- **AND** action SHALL succeed (install-only mode)
