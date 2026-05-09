# Releasing Bygone

This document describes the current release workflow for Bygone:

- VS Code extension package (`.vsix`)
- npm standalone package
- desktop artifacts
- Homebrew formula and cask

It is based on the scripts already in this repository. It does not assume any extra tooling beyond what those scripts already call.

## Quick Start

Validate without publishing:

```bash
npm run release:check
npm run standalone:smoke
npm run release:build
```

Publish everything:

```bash
export VSCE_PAT=...
export BYGONE_HOMEBREW_TAP=/path/to/homebrew-tap
npm whoami
gh auth status
npm run release:publish
```

## What Exists Today

The main scripts are:

- `npm run release:check`
  - runs tests
  - packages the VSIX
  - stages the npm package
  - dry-runs the npm package
- `npm run release:build`
  - runs the full local artifact build without publishing
- `npm run release:publish`
  - publishes npm
  - publishes the VS Code extension
  - creates a GitHub release with desktop artifacts
  - updates and pushes the Homebrew tap

Related packaging commands:

- `npm run package:vsix`
- `npm run package:npm`
- `npm run package:npm:dry-run`
- `npm run package:desktop`
- `npm run package:desktop:mac`
- `npm run package:desktop:mac:zip`
- `npm run package:desktop:linux`
- `npm run package:desktop:win`
- `npm run standalone:smoke`

## Prerequisites

Before publishing, verify:

## Accounts You Need

You need accounts on three services:

### 1. npm

This is required for publishing the standalone package.

- Sign up: [npm signup](https://www.npmjs.com/signup)
- Docs: [npm getting started](https://docs.npmjs.com/getting-started)

After creating the account:

```bash
npm login
npm whoami
```

### 2. GitHub

This is required because the release script creates a GitHub release and uploads desktop artifacts with `gh`.

- Sign up: [GitHub signup](https://github.com/signup)
- Docs: [Creating an account on GitHub](https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github)

After creating the account, authenticate the CLI:

```bash
gh auth login
gh auth status
```

### 3. Visual Studio Marketplace publisher access

This is required for publishing the VS Code extension.

This is a little different from npm and GitHub:

- you need a Microsoft account to use the Marketplace publisher/admin side
- you need a Visual Studio Marketplace publisher
- you need an Azure DevOps Personal Access Token for `vsce`

Publisher/admin surface:

- Marketplace management: [Visual Studio Marketplace manage](https://marketplace.visualstudio.com/manage)

Token/admin surface:

- Azure DevOps PATs: [Azure DevOps personal access tokens](https://dev.azure.com/)

Current practical setup:

1. Sign in to the Marketplace manage page with your Microsoft account.
2. Create or confirm the publisher that matches `package.json`:
   - current publisher: `davidmashburn`
3. In Azure DevOps, create a PAT with Marketplace management/publish permissions.
4. Export it before publishing:

```bash
export VSCE_PAT=...
```

### 4. Homebrew tap repo access

There is no separate Homebrew account for this flow.

What you need is:

- a local checkout of the tap repository
- git push access to that repository

Set:

```bash
export BYGONE_HOMEBREW_TAP=/path/to/homebrew-tap
```

This repository should contain the tap structure used by the release script:

- `Formula/`
- `Casks/`

### 1. npm authentication

```bash
npm whoami
```

If that fails:

```bash
npm login
```

### 2. GitHub authentication

```bash
gh auth status
```

This is required because `release:publish` uses `gh release create`.

### 3. VS Code Marketplace authentication

Set a Personal Access Token for `vsce`:

```bash
export VSCE_PAT=...
```

The publish script uses:

```bash
npx vsce publish --packagePath bygone-<version>.vsix
```

### 4. Homebrew tap checkout

Set:

```bash
export BYGONE_HOMEBREW_TAP=/path/to/homebrew-tap
```

That path must point at a local git checkout of the tap repo. The script writes:

- `Formula/bygone.rb`
- `Casks/bygone-desktop.rb`

and then commits and pushes that tap repo.

## Recommended Release Flow

### Step 1. Confirm the version

```bash
node -p "require('./package.json').version"
```

### Step 2. Run the validation gate

```bash
npm run release:check
npm run standalone:smoke
```

This is the closest thing the repo currently has to a release doctor.

It does **not** check credentials or required environment variables. It only validates the build/package pipeline.

### Step 3. Build all artifacts locally

```bash
npm run release:build
```

This builds:

- VSIX
- staged npm package
- dry-run npm package check
- macOS desktop artifacts
- Linux AppImage
- Windows artifacts
- Homebrew style validation, if `brew` is available

If local packaging is partially unavailable, use the lower-level script:

```bash
node ./scripts/release.mjs --skip-dmg
node ./scripts/release.mjs --skip-windows
```

### Step 4. Inspect expected outputs

Expected outputs include:

- `bygone-<version>.vsix`
- `dist/npm-package/`
- `dist/davidmashburn-bygone-<version>.tgz` after pack
- `dist/Bygone-<version>-arm64.dmg`
- `dist/Bygone-<version>-arm64-mac.zip`
- `dist/Bygone-<version>-arm64.AppImage`
- `dist/Bygone Setup <version>.exe`

### Step 5. Publish

```bash
npm run release:publish
```

This runs the full publish path:

1. `npm publish dist/npm-package --access public`
2. `npx vsce publish --packagePath bygone-<version>.vsix`
3. `gh release create v<version> ... --notes-file CHANGELOG.md`
4. update, commit, and push the Homebrew tap

## Homebrew Notes

Homebrew staging files live in:

- `packaging/homebrew/bygone.rb`
- `packaging/homebrew/bygone-desktop.rb`

The publish script will:

- pack the staged npm package into `dist/`
- compute SHA256 for the npm tarball and DMG
- rewrite the formula and cask in the tap checkout
- run `brew style`
- commit and push the tap

If you want a manual audit step from a tap checkout:

```bash
brew audit --new --formula Formula/bygone.rb
brew audit --new --cask Casks/bygone-desktop.rb
```

The repository-local packaging notes are also in:

- [packaging/homebrew/README.md](/Users/davmash/Git/melden/packaging/homebrew/README.md)

## Troubleshooting

### `npm run release:publish` fails immediately

Check:

- `npm whoami`
- `gh auth status`
- `echo $VSCE_PAT`
- `echo $BYGONE_HOMEBREW_TAP`

### DMG build fails on macOS

Use:

```bash
node ./scripts/release.mjs --skip-dmg
```

Then fix the local DMG toolchain before attempting a full publish.

### Windows packaging fails locally

Use:

```bash
node ./scripts/release.mjs --skip-windows
```

### Homebrew publish fails

Check:

- `BYGONE_HOMEBREW_TAP` points at a real git checkout
- the tap checkout has `Formula/` and `Casks/`
- `brew style` runs successfully

## Current Gap

There is no dedicated `doctor` command yet.

If we add one later, it should check:

- npm auth
- GitHub auth
- `VSCE_PAT`
- `BYGONE_HOMEBREW_TAP`
- presence of required build tools
- expected artifacts after `release:build`
