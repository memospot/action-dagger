# Dagger Action for GitHub

An alternate GitHub Action for running [Dagger](https://dagger.io/) with better caching support.

> [!IMPORTANT]
> This action is only for Linux runners.

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
| `cache-key`              | Custom cache key (e.g. `foo-${{ github.run_id }}`)    | false    | ''                 |
| `cache-mode`             | Cache extraction mode (`auto`, `direct`, `container`) | false    | 'auto'             |
| `cache-timeout`          | Timeout in minutes for cache save operations (0=disable) | false    | '10'            |
| `dagger-flags`            | Dagger CLI Flags                                      | false    | '--progress plain' |
| `verb`                   | CLI verb (call, run, download, up, functions, shell, query) | false | 'call'          |
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
| `output`         | Standard output of Dagger command              |
| `trace-url`      | Dagger Cloud trace URL                          |

## Cache Strategy

### Binary Cache

The Dagger binary is cached using GitHub Actions tool-cache by tool/version/arch lookup.

- Tool name: `dagger`
- Version: resolved Dagger version (including `latest` resolution)
- Arch: runner architecture (for example `amd64` or `arm64`)

### Build Cache

Dagger build cache persists the engine state volume to GitHub Actions Cache:
- **Default Behavior**: "Rolling cache" strategy.
  - **Save Key**: `dagger-<arch>-<run_id>` (always unique, forcing a save)
  - **Restore Key**: `dagger-<arch>-` (matches most recent previous run)
- This ensures that every run saves its state on top of the previous one, maximizing cache freshness.

#### Custom Cache Keys

You can override the default key using `cache-key`. To maintain the rolling cache behavior (recommended), ensure your key ends with a unique component like `${{ github.run_id }}`.

```yaml
- name: Run Dagger with custom key
  uses: memospot/action-dagger@v1
  with:
    # Use a custom prefix but keep the rolling behavior
    cache-key: 'my-project-v2-${{ runner.os }}-${{ github.run_id }}'
    module: github.com/shykes/daggerverse/hello
    call: hello
```

The action will automatically derive the restore key by stripping the last hyphen-delimited segment (e.g., `my-project-v2-${{ runner.os }}`).

#### Cache Invalidation

To invalidate the cache, simply change the prefix of your `cache-key` (e.g., from `v1` to `v2`). If using defaults, the action handles versioning internally.

#### Cache Modes

The `cache-mode` input controls how the Dagger engine state is cached:

- **`auto`** (default): Automatically tries `direct` mode first, then falls back to `container` if it fails. This is the recommended mode for most users.
- **`direct`**: Uses direct volume mounting for faster cache operations. May encounter permission issues on some runners.
- **`container`**: Uses a busybox container to create/restore tarballs. Slower and with higher disk usage peak, but more reliable.

Cache failures in any mode are soft-failures - the action will emit a warning but continue execution.

```yaml
- name: Run Dagger with explicit cache mode
  uses: memospot/action-dagger@v1
  with:
    cache-mode: direct  # Force direct mode (faster, may fail on some runners)
    module: github.com/shykes/daggerverse/hello
    call: hello
```

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
2. Verify platform support. Only Linux is supported.
3. Check network access to `dl.dagger.io`

### Version Issues

1. Use semantic version format: `0.15.0` or `v0.15.0`
2. Use `latest` for the most recent release
3. Check [Dagger releases](https://github.com/dagger/dagger/releases) for available versions

## License

BSD-2-Clause-Patent

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for development setup, project structure, and release process.
