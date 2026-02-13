# Dagger Action for GitHub

An alternate GitHub Action for running [Dagger](https://dagger.io/) with better caching support.

## Usage Examples

### Basic Usage

```yaml
- name: Run Dagger
  uses: memospot/action-dagger@v1
  with:
    module: github.com/shykes/daggerverse/hello
    call: hello --greeting Hola --name Jeremy
```

### With Version Pinning

```yaml
- name: Run Dagger with specific version
  uses: memospot/action-dagger@v1
  with:
    version: '0.19.11'  # Pin to specific version
    module: github.com/shykes/daggerverse/hello
    call: hello
```

### With Caching Disabled

```yaml
- name: Run Dagger without caching
  uses: memospot/action-dagger@v1
  with:
    cache-builds: false
    cache-binary: false
    module: github.com/shykes/daggerverse/hello
    call: hello
```

### dagger shell

```yaml
- name: Dagger Shell
  uses: memospot/action-dagger@v1
  with:
    shell: container | from alpine | with-exec echo,"hello, world!" | stdout
```

### dagger run

```yaml
- name: Integration Test
  uses: memospot/action-dagger@v1
  with:
    workdir: db-service
    verb: run
    args: node build.js
```

## Inputs

| Key                      | Description                                           | Required | Default            |
| ------------------------ | ----------------------------------------------------- | -------- | ------------------ |
| `version`                | Dagger CLI version (semver or 'latest')               | false    | 'latest'           |
| `cache-builds`           | Enable Dagger build cache persistence                 | false    | true               |
| `cache-binary`           | Cache Dagger binary to avoid re-downloading           | false    | true               |
| `cache-version`          | Cache version for invalidation (change to clear cache)  | false    | 'v2'               |
| `dagger-flags`           | Dagger CLI Flags                                      | false    | '--progress plain' |
| `verb`                   | CLI verb (call, run, download, up, functions, shell)  | false    | 'call'             |
| `workdir`                | Working directory for Dagger CLI                      | false    | '.'                |
| `cloud-token`            | Dagger Cloud Token                                    | false    | ''                 |
| `module`                 | Dagger module to call (local or Git)                  | false    | ''                 |
| `args`                   | Arguments to pass to CLI                              | false    | ''                 |
| `call`                   | Function and arguments for dagger call                | false    | ''                 |
| `shell`                  | Function and arguments for dagger shell               | false    | ''                 |
| `summary-path`           | File path to write job summary                        | false    | ''                 |
| `enable-github-summary`  | Write summary to GITHUB_STEP_SUMMARY                  | false    | false              |

## Outputs

| Key              | Description                                    |
| ---------------- | ---------------------------------------------- |
| `dagger-version` | The installed Dagger version                   |
| `cache-hit`      | Whether binary was restored from cache         |
| `binary-path`    | Path to the installed Dagger binary            |
| `stdout`         | Standard output of Dagger command              |
| `traceURL`       | Dagger Cloud trace URL                         |

## Cache Strategy

### Binary Cache

The Dagger binary is cached using GitHub Actions tool-cache:
- **Cache key**: `dagger-<version>-<platform>-<arch>`
- When `version: latest`, the action fetches the latest version and checks cache
- Supported platforms: Linux (amd64, arm64), macOS (amd64, arm64)

### Build Cache

Dagger build cache persists the engine state volume to GitHub Actions Cache:
- **Cache key**: `dagger-buildkit-<version>-<platform>-<dagger-version>-<repo>-<workflow>`
- **Restore keys**:
  - `dagger-buildkit-<version>-<platform>-<dagger-version>-<repo>-`
  - `dagger-buildkit-<version>-<platform>-<dagger-version>-`
- Cache is saved even on workflow failure for partial progress
- Uses `_EXPERIMENTAL_DAGGER_RUNNER_HOST` to connect to cached engine

#### Cache Invalidation

Use `cache-version` to invalidate caches when needed:

```yaml
- name: Run Dagger with cache invalidation
  uses: memospot/action-dagger@v1
  with:
    cache-version: 'v3'  # Bump to force fresh cache
    module: github.com/shykes/daggerverse/hello
    call: hello
```

Common reasons to change cache version:
- Corrupted cache data
- Dagger engine state format changes
- Debugging cache-related issues

## Migration Guide

### From dagger/dagger-for-github

This action is a TypeScript rewrite of [dagger/dagger-for-github](https://github.com/dagger/dagger-for-github) with new caching capabilities:

1. **Update your workflow**:
   ```yaml
   # Before
   uses: dagger/dagger-for-github@v7

   # After
   uses: memospot/action-dagger@v1
   ```

2. **New features available**:
   - Binary caching: `cache-binary: true`
   - Build caching: `cache-builds: true`
   - Version output: `${{ steps.dagger.outputs.dagger-version }}`

3. **Backward compatibility**: All existing inputs continue to work

## Troubleshooting

### Cache Not Working

1. Check that `cache-builds` is set to `true` (default)
2. Verify GitHub Actions Cache is available in your repository
3. Check workflow logs for cache restore/save messages

### Binary Not Found

1. Check the `binary-path` output
2. Verify platform support (Linux/macOS, x64/ARM64)
3. Check network access to `dl.dagger.io`

### Version Issues

1. Use semantic version format: `0.15.0` or `v0.15.0`
2. Use `latest` for the most recent release
3. Check [Dagger releases](https://github.com/dagger/dagger/releases) for available versions

## License

BSD-2-Clause-Patent

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and release process.
