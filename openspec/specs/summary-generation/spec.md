## ADDED Requirements

### Requirement: Generate job summary

The system SHALL generate job summaries with command details when requested.

#### Scenario: GitHub summary enabled

- **WHEN** enable-github-summary="true"
- **THEN** summary SHALL be written to GITHUB_STEP_SUMMARY
- **AND** summary SHALL include command, trace URL, and version

#### Scenario: GitHub summary disabled

- **WHEN** enable-github-summary="false" (default)
- **THEN** no summary SHALL be written to GITHUB_STEP_SUMMARY

#### Scenario: Custom summary path

- **WHEN** summary-path="/tmp/my-summary.md" is provided
- **THEN** summary SHALL be written to that path
- **AND** file SHALL be created with markdown content

#### Scenario: Both summary options

- **WHEN** both enable-github-summary="true" AND summary-path is set
- **THEN** summary SHALL be written to both locations

### Requirement: Summary content format

The system SHALL generate well-formatted markdown summaries.

#### Scenario: Command section

- **GIVEN** a dagger command was executed
- **THEN** summary SHALL include "## Command" section
- **AND** command SHALL be in code block

#### Scenario: Trace section

- **GIVEN** a trace URL was captured
- **THEN** summary SHALL include "## Dagger trace" section
- **AND** trace URL SHALL be a clickable link

#### Scenario: Version section

- **THEN** summary SHALL include "## Dagger version" section
- **AND** version SHALL be in code block

#### Scenario: Script display for shell input

- **WHEN** shell input was used
- **THEN** summary SHALL include "### Script" subsection
- **AND** script content SHALL be shown in code block

### Requirement: Summary formatting

The system SHALL format summaries consistently.

#### Scenario: Markdown structure

- **THEN** summary SHALL use proper markdown headings
- **AND** code blocks SHALL use ```bash syntax
- **AND** links SHALL use [text](url) format

#### Scenario: Empty trace handling

- **WHEN** no trace URL is available
- **THEN** trace section SHALL show setup link
- **AND** message "No trace available" SHALL appear
