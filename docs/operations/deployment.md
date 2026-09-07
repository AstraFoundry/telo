# Build and release

Telo is distributed as a desktop application. There is no server deployment or container image.

## Local artifacts

```sh
make build
make package
```

The compiled app is written to `out/`; unpacked or installer artifacts are written to `release/`. Native `tdl` stays asar-unpacked. `libtdjson` is copied to `resources/tdlib-native` at pack time so the packaged process does not load it from pnpm's asar `node_modules`. Windows arm64 is unsupported. After packaging, `make tdlib-smoke` probes `authorizationStateWaitPhoneNumber` without a phone login. Tag releases run the same smoke on macOS, Windows x64, and Ubuntu.

Packaged applications use `Telo` as the operating-system display name. Branding assets live under `build/`: `icon.icns` for macOS, `icon.ico` for Windows, and dimension-named PNG files under `build/icons/` for Linux. `icon-artwork.png` preserves the selected full-resolution artwork. `icon-source.png` and `icon.png` contain the normalized 1024×1024 rounded tile with transparent platform-safe margins used to derive the platform assets.

## CI

Every pull request runs two Ubuntu jobs: `check` (format, lint, TypeScript, coverage-gated tests, Markdown) and `e2e` (Playwright against Electron under Xvfb). A tag matching `v*` starts a matrix build on macOS, Windows, and Ubuntu. Electron Builder creates native artifacts and GitHub Actions uploads them to the GitHub release associated with the tag.

Signing credentials are optional in development and required for trusted production distribution. Configure Apple signing/notarization and Windows code-signing secrets in the repository before publishing to end users.

## Rollback

Mark the affected GitHub release as a pre-release, restore the previous release as latest, and publish a patch tag after the fix passes `make check`.
