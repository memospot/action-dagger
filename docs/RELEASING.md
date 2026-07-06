# Releasing

Releases are automated via `.github/workflows/release.yml`.

## Release Flow

1. Make changes and merge to `main`
2. Run local checks: `bun test && bun run lint && bun run build`
3. Create and push a version tag:

```bash
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```

The workflow will:
- Run tests and build
- Commit `dist/index.js` and re-tag
- Update floating tags (`v1`, `v1.2`)
- Create a GitHub release

## Version Bump Guide

- **Patch** (`v1.0.0` → `v1.0.1`): Bug fixes
- **Minor** (`v1.0.0` → `v1.1.0`): New features, backward-compatible
- **Major** (`v1.0.0` → `v2.0.0`): Breaking changes

## Rollback

```bash
git tag -fa v1 -m "Rollback to v1.0.0"
git push origin v1 --force
```
