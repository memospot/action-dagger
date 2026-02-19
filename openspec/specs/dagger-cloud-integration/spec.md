## ADDED Requirements

### Requirement: Set Dagger Cloud authentication

The system SHALL set DAGGER_CLOUD_TOKEN environment variable when provided.

#### Scenario: Cloud token provided

- **WHEN** cloud-token="dag_..." is provided
- **THEN** DAGGER_CLOUD_TOKEN SHALL be set in environment
- **AND** dagger SHALL use it for Cloud authentication

#### Scenario: No cloud token

- **WHEN** cloud-token is empty
- **THEN** DAGGER_CLOUD_TOKEN SHALL NOT be set
- **AND** dagger SHALL run without Cloud integration

### Requirement: Extract trace-url from output

The system SHALL extract Dagger Cloud trace URLs from command stderr and expose them as `trace-url`.

#### Scenario: Trace URL present in stderr

- **WHEN** dagger outputs "<https://dagger.cloud/org/traces/abc123>" to stderr
- **THEN** the `trace-url` output SHALL be set to that URL

#### Scenario: Setup URL when no token

- **WHEN** no cloud-token is provided
- **AND** dagger outputs "<https://dagger.cloud/traces/setup>"
- **THEN** `trace-url` SHALL be "<https://dagger.cloud/traces/setup>"

#### Scenario: No trace URL found

- **WHEN** no Dagger Cloud URL is present in output
- **THEN** `trace-url` output SHALL be empty
- **AND** no error SHALL occur

#### Scenario: Multiple trace URLs

- **WHEN** multiple trace URLs appear in output
- **THEN** the first URL SHALL be used
- **AND** captured `trace-url` SHALL be a valid Dagger Cloud URL

### Requirement: Trace URL format validation

The system SHALL recognize valid Dagger Cloud trace URLs.

#### Scenario: Standard trace URL format

- **GIVEN** URL pattern "<https://dagger.cloud/{org}/traces/{id}>"
- **THEN** it SHALL be recognized as valid trace URL

#### Scenario: Setup URL format

- **GIVEN** URL "<https://dagger.cloud/traces/setup>"
- **THEN** it SHALL be recognized as valid trace URL
