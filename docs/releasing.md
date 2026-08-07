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
export BYGONE_HOMEBREW_TAP=/path/to/homebrew-tap
npm whoami
gh auth status
npm run release:publish
gh workflow run publish-vscode.yml -f release_ref=v<version> -f version=<version>
```

The VS Code workflow uses GitHub OIDC trusted publishing. It does not use a
Marketplace PAT or repository secret.

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
  - creates a GitHub release with desktop artifacts
  - updates and pushes the Homebrew tap
- `.github/workflows/publish-vscode.yml`
  - packages an explicitly selected release commit or tag
  - verifies its version before publishing
  - publishes the VS Code extension through a short-lived GitHub OIDC credential

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

This is a little different from npm and GitHub. The repository uses trusted
publishing rather than a long-lived Personal Access Token. You need access to
the Visual Studio Marketplace publisher to configure the one-time trust policy,
but routine releases run entirely through GitHub Actions.

Publisher/admin surface:

- Marketplace management: [Visual Studio Marketplace manage](https://marketplace.visualstudio.com/manage)

Current practical setup:

1. Sign in to the Marketplace manage page with your Microsoft account.
2. Create or confirm the publisher that matches `package.json`:
   - current publisher: `davidmashburn`
3. Configure a GitHub trusted-publishing policy for:
   - owner: `davidmashburn`
   - repository: `bygone`
   - workflow: `publish-vscode.yml`
4. Do not create a `VSCE_PAT` secret. The workflow requests a short-lived token
   with `id-token: write` and the Marketplace exchanges it only when the policy
   matches.

OIDC support is merged into `microsoft/vscode-vsce` but is not present in its
latest npm release, 3.9.2. The workflow therefore checks out and builds the
exact reviewed merge commit `c998e2a8604ba07d2b6a364d1742c1bc38e7d8ff`.
Replace that source-build step with the first stable `@vscode/vsce` release
that contains `publish --oidc`.

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

### 3. VS Code Marketplace trusted publishing

Confirm the Marketplace policy described above exists. The workflow publishes
with:

```bash
vsce publish --oidc --packagePath bygone-<version>.vsix
```

This command is valid only inside the authorized GitHub Actions workflow; local
shells do not receive GitHub's OIDC token.

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
2. `gh release create v<version> ... --notes-file CHANGELOG.md`
3. update, commit, and push the Homebrew tap

Publish the VS Code extension separately after the release commit or tag is on
GitHub:

```bash
gh workflow run publish-vscode.yml \
  -f release_ref=v<version> \
  -f version=<version>
```

The workflow checks that `package.json` exactly matches the requested version
before it packages or publishes anything.

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
- `echo $BYGONE_HOMEBREW_TAP`

### VS Code trusted publishing fails

Check:

- the Marketplace policy names `davidmashburn/bygone`
- the policy names `.github/workflows/publish-vscode.yml`
- the workflow has `id-token: write`
- `release_ref` contains exactly the requested `package.json` version
- the pinned `vscode-vsce` commit still builds successfully

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
- the Marketplace trusted-publishing policy
- `BYGONE_HOMEBREW_TAP`
- presence of required build tools
- expected artifacts after `release:build`
