# Cache Timeout Protection

## Purpose

Prevent cache operations from hanging indefinitely by implementing configurable timeouts with graceful degradation.

## Requirements

### REQ-1: Configurable Timeout

The action MUST accept a `cache-timeout` input with:
- Type: integer
- Default: 10
- Minimum: 0 (disables timeout)
- Description: Maximum time to wait for cache save/restore before aborting

### REQ-2: Timeout Enforcement

When `cache-timeout` > 0:
- Cache save operations MUST timeout after the specified duration
- A descriptive error message MUST be provided on timeout
- The operation MUST be cancelled/interrupted

### REQ-3: Soft-Fail Behavior

On timeout:
- The action MUST NOT fail the workflow
- A warning MUST be logged explaining the timeout
- A success message MUST indicate continuation without cache
- The workflow MUST proceed normally

### REQ-4: Timeout Disabled

When `cache-timeout` = 0:
- No timeout SHOULD be applied
- Operations MAY run indefinitely (backward compatible)

## Acceptance Criteria

1. Given a cache save that takes longer than N minutes
   When `cache-timeout`=N
   Then the operation aborts with a timeout message
   And the workflow continues successfully

2. Given a cache save that completes in less than N minutes
   When `cache-timeout`=N
   Then the cache is saved normally
   And the workflow continues successfully

3. Given `cache-timeout`=0
   When cache operations run
   Then no timeout is enforced (backward compatible)
