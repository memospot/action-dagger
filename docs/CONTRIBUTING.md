# Contributing to Dagger Action

## Technology Stack

| Category                    | Technology  | Version  |
|-----------------------------|-------------|----------|
| Programming language        | TypeScript  | >=5.9.3  |
| Runtime and package manager | Bun         | >=1.3.9  |
| Target                      | Node.js     | >=24.0.0 |
| Build                       | Bun bundler | built-in |
| Testing                     | Bun test    | built-in |
| Lint/Format                 | Biome       | >=2.3    |
| GitHub Actions              | @actions/*  | latest   |

## Basic Project Structure

```text
├── .agent/docs       # Documentation targeted at Agents
│   ├── KB.md         # Agent Knowledge Base. Must be consulted.
│   ├── PLANS.md      # Execution Plans (ExecPlans)
│   └── STANDARDS.md  # Coding standards
├── .github/workflows  # CI/CD Workflows
├── docs/             # Documentation targeted at Humans
├── src/              # Main action source code
│   ├── main.ts
│   └── …
├── tests/            # Test files
│   ├── main.test.ts
│   └── …
├── action.yml        # GitHub Action metadata
├── package.json
├── tsconfig.json
└── biome.jsonc       # BiomeJS configuration
```

## Development

### Prerequisites

- [Bun](https://bun.sh/) runtime

### Setup

```bash
# Clone the repository
git clone https://github.com/memospot/action-dagger.git
cd action-dagger

# Install dependencies
bun install

# Run tests
bun test

# Run linting
bun run lint

# Format code
bun run fmt
```

### Build

```bash
# Build the action
bun run build

# Output: dist/index.js
```

## Release Process

This project uses semantic versioning and automated releases.

### Creating a Release

1. **Ensure all tests pass**
   ```bash
   bun test
   bun run lint
   bun run build
   ```

2. **Create a new version tag**
   ```bash
   git tag -a v1.2.3 -m "Release version 1.2.3"
   git push origin v1.2.3
   ```

3. **Automated release process**
   - The release workflow will automatically:
     - Run tests
     - Build the project
     - Commit `dist/index.js`
     - Update the major version tag (e.g., `v1`)
     - Create a GitHub release

### Version Tagging

- **Patch releases** (bug fixes): `v1.0.0` → `v1.0.1`
- **Minor releases** (features): `v1.0.0` → `v1.1.0`
- **Major releases** (breaking changes): `v1.0.0` → `v2.0.0`

Floating tags are automatically updated on each release:

- **Major tag** (e.g., `v1`) → points to the latest `v1.x.x` release
- **Minor tag** (e.g., `v1.1`) → points to the latest `v1.1.x` release

This allows users to reference the action at different granularity levels:
```yaml
uses: memospot/action-dagger@v1      # latest v1.x.x
uses: memospot/action-dagger@v1.1    # latest v1.1.x
uses: memospot/action-dagger@v1.1.1  # exact pin
```

### Rollback

To rollback to a previous version:

```bash
git tag -fa v1 -m "Rollback to v1.0.0"
git push origin v1 --force
```
