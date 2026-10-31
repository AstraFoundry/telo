# Build and release

Telo is distributed as a desktop application. There is no server deployment or container image.

## Local artifacts

```sh
make build      # build/telo for this platform
make package    # the packaged app under build/<os>-<arch>/
```

`make package` runs `mygo build` with `mygo.json` (name, identifier `si.astrafoundry.telo`, version, the `tg:` URL scheme) and links the Telegram API credentials and the Google OAuth client from the environment through `MYGO_LDFLAGS`. It ships `build/tdlib-native` as a resource beside the executable, where `bootstrap` loads `libtdjson`. It produces a signed `.app` and a `.dmg` on macOS (ad-hoc unless a signing identity is set), the executable and an NSIS installer (`telo-setup-<version>-<arch>.exe`) on Windows, and the executable, a `.tar.gz` with `install.sh` and a `.deb` on Linux. Windows arm64 is not supported: `prebuilt-tdlib` has no build for it.

The icon is `resources/icon.png`.

## CI

`.github/workflows/ci.yml` runs `make check` on Ubuntu, macOS and Windows for every pull request and push to `main`: gofmt, vet, generated code, FSD/DDD imports, the TDLib capability matrix, telegram-macos parity, the Go tests against the staged libtdjson (headless UI tests included), and the documentation. The Ubuntu job also uploads the UI snapshots (`make snapshots`) as an artifact for review.

A tag matching `v*` runs `.github/workflows/release.yml`: `make check` and `make package` on macOS, Windows and Ubuntu with the `TELO_TELEGRAM_API_ID`, `TELO_TELEGRAM_API_HASH` and `TELO_GOOGLE_OAUTH_CLIENT_ID` secrets, then attaches the artifacts to the tag's GitHub release.

Signing is optional for development and required for trusted distribution. Set the macOS signing identity and notarization in `mygo.json` and configure Windows code signing before publishing to end users.

## Rollback

Mark the affected release as a pre-release, restore the previous release as latest, and publish a patch tag after the fix passes `make check`.
