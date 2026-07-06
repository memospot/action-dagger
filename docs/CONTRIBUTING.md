# Contributing

## Prerequisites

- [Bun](https://bun.sh/) runtime

## Setup

```bash
git clone https://github.com/memospot/action-dagger.git
cd action-dagger
bun install
```

## Development Workflow

```bash
# Run all checks before committing
bun run lint
bun run build
bun test

# Format code
bun run fmt
```

## Project Structure

```text
src/              # Action source code (TypeScript)
tests/            # Test files
.github/workflows # CI/CD workflows
docs/             # Documentation
action.yml        # GitHub Action metadata
dist/index.js     # Built action (auto-generated, do not commit manually)
```

## Key Conventions

- Use `@actions/core` for all logging (not `console.log`)
- Dagger version must be ≥ v0.15.0
- Linux runner only
- Do not manually commit `dist/index.js` — the release workflow handles it

## Releasing

See [RELEASING.md](RELEASING.md) for the release process.
