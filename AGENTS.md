# AGENTS.md

Canonical instructions for AI assistants working on this codebase.

## Overview

A GitHub Action that installs the Dagger CLI and runs Dagger commands with
intelligent caching (binary + engine build cache). Written in TypeScript on
Bun, distributed as `dist/index.js`. Linux-only.

## Architecture

- **Two-phase lifecycle**: `src/main.ts` dispatches main phase (`action-run.ts`)
  and post phase (`action-post.ts`) via `STATE_isPost` state variable.
- **Main phase**: parse inputs → get binary (tool-cache or download) → restore
  engine volume cache → start Dagger engine → execute command → set outputs.
- **Post phase (`post-if: always()`)**: stop engine → save engine volume cache.
  Always runs even if the main phase fails.
- **Cache modes**: `auto` (try direct mount, fallback to container tarball),
  `direct` (bind-mount Docker volume to host), `container` (busybox tar).
  Cache failures are soft — warning only, execution continues.
- **Engine config**: Generated `engine.toml` with dynamic GC policy based on
  cache size estimate (max 1.5× cache, min 15% free) or static defaults.
- **Binary download**: Primary from `dl.dagger.io`, fallback to GitHub Releases
  (uses `GITHUB_TOKEN` for auth if available).

## Key rules

- **Do not manually commit `dist/index.js`**. The release workflow handles it.
- **Use `@actions/core`** for all logging (`core.debug`, `core.info`,
  `core.warning`, `core.setFailed`). Do not use `console.log`.
- **Tool-cache downloads can fail** (`@actions/tool-cache`). Handle errors and
  provide fallback paths.
- **Dagger version must be ≥ v0.15.0** (unless using a `commit` input).
  Validate in `action-run.ts` via `isVersionAtLeast()`.
- **Linux runner enforcement**: both main and post phases check
  `process.platform !== "linux"` and exit early.
- **Build cache requires Docker** — engine runs in a privileged container,
  communicates via Docker socket bind mount.
- **Scorecards workflow** is read-only CI; do not modify it.
- **OpenSpec archives** live in `openspec/changes/archive/`. Do not modify or
  manually commit them. Use `openspec/changes/` for active proposals only.

## Commands

```text
lint → build → test
```

```bash
# Install
bun install

# All checks (run before commit)
bun run lint
bun run build
bun test

# Single-test workflow
bun test tests/cache.test.ts

# Format
bun run fmt
bun run fmt:check
```

## CI notes

- **Lint uses Biome** (config: `biome.jsonc`). No Prettier or ESLint.
- **Release workflow**: tag push `v*` → test → build → commit `dist/index.js`
  → update `v<N>` and `v<N>.<M>` floating tags → create GitHub release.
  Committing `dist/index.js` during release uses `GITUB_TOKEN` which does not
  trigger other workflows.
- **Integration tests** (`test.yml`) run the actual action against a live
  Dagger engine. Separate from unit tests in `ci.yml`.
- **Cache key pattern**: default rolling key `dagger-<arch>-<run_id>`; restore
  key strips the last `-` segment. Custom keys should follow the same pattern.

## Structure

```text
src/main.ts          — entrypoint (main/post dispatch)
src/action-run.ts    — main phase orchestration
src/action-post.ts   — post-phase cache save
src/input-parse.ts   — action input parsing
src/cache.ts         — build cache restore + save
src/dagger.ts        — binary download/cache via @actions/tool-cache
src/engine.ts        — Docker volume + container management
src/exec.ts          — dagger command execution (pre-assembled args array)
src/engine-config.ts — engine.toml GC policy generation
src/output-summary.ts — job summary generation (custom path + GITHUB_STEP_SUMMARY)
src/version.ts       — semver comparison utilities
```
