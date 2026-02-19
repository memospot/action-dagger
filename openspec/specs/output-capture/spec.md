## ADDED Requirements

### Requirement: Capture command stdout

The system SHALL capture stdout from dagger commands and expose as output.

#### Scenario: Capture command output

- **WHEN** dagger command produces stdout
- **THEN** the output action output SHALL contain that stdout
- **AND** output SHALL be set via core.setOutput

#### Scenario: Multi-line output

- **WHEN** dagger command produces multi-line output
- **THEN** all lines SHALL be preserved
- **AND** line endings SHALL be maintained

#### Scenario: Empty output

- **WHEN** dagger command produces no stdout
- **THEN** output SHALL be empty string
- **AND** no error SHALL occur

#### Scenario: Large output handling

- **WHEN** dagger command produces large output
- **THEN** output SHALL be captured without truncation
- **AND** memory usage SHALL remain reasonable

### Requirement: Legacy output compatibility

The system SHALL maintain backward compatibility with legacy output behavior.

#### Scenario: Legacy output name

- **WHEN** setting command output
- **THEN** it SHALL be available as "output" (legacy name)
- **AND** also as "dagger-version" for version commands

### Requirement: Stderr preservation

The system SHALL preserve stderr for trace URL extraction while keeping it available.

#### Scenario: Stderr captured separately

- **WHEN** dagger outputs to stderr
- **THEN** stderr SHALL be captured for trace URL extraction
- **AND** original output SHALL be preserved
