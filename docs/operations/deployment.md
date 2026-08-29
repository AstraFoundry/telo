# Build and release

Telo is distributed as a desktop application. There is no server deployment or container image.

## Local artifacts

```sh
make build
make package
```

The compiled app is written to `out/`; unpacked or installer artifacts are written to `release/`.

## CI

Every pull request runs two Ubuntu jobs: `check` (format, lint, TypeScript, coverage-gated tests, Markdown) and `e2e` (Playwright against Electron under Xvfb). A tag matching `v*` starts a matrix build on macOS, Windows, and Ubuntu. Electron Builder creates native artifacts and GitHub Actions uploads them to the GitHub release associated with the tag.

Signing credentials are optional in development and required for trusted production distribution. Configure Apple signing/notarization and Windows code-signing secrets in the repository before publishing to end users.

## Rollback

Mark the affected GitHub release as a pre-release, restore the previous release as latest, and publish a patch tag after the fix passes `make check`.
