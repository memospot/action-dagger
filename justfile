# Justfile for action-dagger
# https://github.com/casey/just

# Default recipe - show available commands
default:
    @just --list

# Install dependencies
install:
    bun install

# Run in development mode (watch)
dev:
    bun run dev

# Build for production
build:
    bun run build

# Run tests
test:
    bun test

# Run tests with coverage
test-coverage:
    bun run test:coverage

# Check linting
lint:
    bun run lint

# Fix linting issues
lint-fix:
    bun run lint:fix

# Check formatting
fmt-check:
    bun run fmt:check

# Format code
fmt:
    bun run fmt

# Full validation (lint, format check, test, build)
validate: lint fmt-check test build

# Publish a new release
# Usage: just publish v1.2.3
publish v:
    #!/usr/bin/env bash
    set -euo pipefail

    VERSION="{{v}}"

    # Validate version format
    if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Error: Version must be in format vMAJOR.MINOR.PATCH (e.g., v1.2.3)"
        exit 1
    fi

    # Ensure we're on main branch
    CURRENT_BRANCH=$(git branch --show-current)
    if [ "$CURRENT_BRANCH" != "main" ]; then
        echo "Error: Must be on main branch to publish (currently on: $CURRENT_BRANCH)"
        exit 1
    fi

    # Ensure working directory is clean
    if [ -n "$(git status --porcelain)" ]; then
        echo "Error: Working directory is not clean. Please commit or stash changes first."
        exit 1
    fi

    echo "Publishing release $VERSION..."

    # Pull latest changes
    git pull origin main

    # Run full validation
    echo "Running validation..."
    just validate

    # Create and push the version tag
    # This will trigger the release workflow
    echo "Creating tag $VERSION..."
    git tag -a "$VERSION" -m "Release $VERSION"
    git push origin "$VERSION"

    echo ""
    echo "Release $VERSION published!"
    echo "The release workflow will now:"
    echo "  - Build the project"
    echo "  - Commit dist/index.js"
    echo "  - Update major tag ($(echo $VERSION | cut -d. -f1))"
    echo "  - Update minor tag ($(echo $VERSION | cut -d. -f1-2))"
    echo "  - Create a GitHub release"
    echo ""
    echo "Monitor progress at: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/\.git$//')/actions"
