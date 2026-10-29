# Homebrew Packaging

These files stage Homebrew distribution without publishing anything.

- `bygone.rb` is the CLI formula. It installs the scoped npm tarball and exposes `bygone`.
- `bygone-desktop.rb` is the desktop cask. It installs `Bygone.app` and symlinks its launcher as `bygone`. The launcher follows symlinks before locating the app executable.

Desktop builds are unsigned and not notarized. The cask removes only
`com.apple.quarantine` from the installed app bundle, including its contents, to
allow it to launch. This bypasses the quarantine check for Bygone without changing
the system-wide Gatekeeper setting or removing other extended attributes. The
cask displays this caveat during installation and respects Homebrew's `--appdir`.

Before publishing:

1. Build and publish release artifacts.
2. Replace the placeholder all-zero `sha256` values with the actual tarball and DMG checksums.
3. Adjust the cask URL for the exact artifact name and architecture strategy used by the release.
4. Run `brew audit --new --formula packaging/homebrew/bygone.rb` and `brew audit --new --cask packaging/homebrew/bygone-desktop.rb` from a tap checkout.

The cask can install the command-line entry automatically through its `binary` stanza. The app menu item `Install Command Line Tools...` remains useful for non-Homebrew installs, manual DMG installs, and repair/reinstall cases.
