# Cache Debugging

## Purpose

Provide visibility into cache operations for troubleshooting performance issues and understanding cache growth.

## Requirements

### REQ-1: Archive Size Logging

After creating the cache archive:
- The action MUST log the archive file size in MB
- The format SHOULD be: "📊 Archive size: X.XX MB"
- The size MUST use two decimal places

### REQ-2: Tar Progress Visibility

When `ACTIONS_STEP_DEBUG` is enabled:
- The tar command MUST use verbose mode (`cvf`)
- The tar command MUST include `--totals` flag
- Progress SHOULD be visible in the action logs

When `ACTIONS_STEP_DEBUG` is NOT enabled:
- The tar command SHOULD use quiet mode (`cf`)
- No progress output SHOULD be shown

### REQ-3: Timeout Visibility

When a timeout occurs:
- The warning MUST include the timeout duration
- The message MUST explain that caching is being skipped
- A success message MUST confirm continuation

## Acceptance Criteria

1. Given a cache save operation
   When the archive is created
   Then the archive size is logged in MB with 2 decimal places

2. Given `ACTIONS_STEP_DEBUG=true`
   When cache backup runs
   Then tar shows file listings and totals

3. Given `ACTIONS_STEP_DEBUG=false`
   When cache backup runs
   Then tar runs silently without progress output

4. Given a timeout occurs
   Then the log shows:
   - Warning with timeout duration
   - Explanation that cache is skipped
   - Success message that workflow continues
