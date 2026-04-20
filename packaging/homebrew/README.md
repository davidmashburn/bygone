# Homebrew Packaging

These files stage Homebrew distribution without publishing anything.

- `bygone.rb` is the CLI formula. It installs the scoped npm tarball and exposes `bygone`.
- `bygone-desktop.rb` is the desktop cask. It installs `Bygone.app` and symlinks the app executable as `bygone`.

Before publishing:

1. Build and publish release artifacts.
2. Replace the placeholder all-zero `sha256` values with the actual tarball and DMG checksums.
3. Adjust the cask URL for the exact artifact name and architecture strategy used by the release.
4. Run `brew audit --new --formula packaging/homebrew/bygone.rb` and `brew audit --new --cask packaging/homebrew/bygone-desktop.rb` from a tap checkout.

The cask can install the command-line entry automatically through its `binary` stanza. The app menu item `Install Command Line Tools...` remains useful for non-Homebrew installs, manual DMG installs, and repair/reinstall cases.
