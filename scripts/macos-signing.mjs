// Shelved: not wired into release:publish until Apple Developer Program membership is active.
// See docs/releasing.md#future-signing-not-enabled.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const signingConfig = 'packaging/macos/electron-builder.signing.json';

export { signingConfig };

export function hasMacNotarizationCredentials() {
    const apiKeyPath = process.env.APPLE_API_KEY ?? process.env.APPLE_API_KEY_PATH;
    const apiKey = apiKeyPath && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
    const appleId = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
    const keychainProfile = process.env.APPLE_KEYCHAIN && process.env.APPLE_KEYCHAIN_PROFILE;
    return Boolean(apiKey || appleId || keychainProfile);
}

export function hasExplicitMacSigningCredentials() {
    return Boolean(
        process.env.CSC_LINK
        || process.env.CSC_NAME
        || process.env.CSC_LINK_BASE64
    );
}

export function findDeveloperIdApplicationIdentity() {
    if (process.platform !== 'darwin') {
        return null;
    }

    try {
        const output = execFileSync(
            'security',
            ['find-identity', '-v', '-p', 'codesigning'],
            { encoding: 'utf8' }
        );
        const match = output
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.includes('Developer ID Application:'));
        if (!match) {
            return null;
        }

        const identityMatch = match.match(/"([^"]+)"/);
        return identityMatch?.[1] ?? null;
    } catch {
        return null;
    }
}

export function hasMacSigningCertificate() {
    if (hasExplicitMacSigningCredentials()) {
        return true;
    }

    if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
        return false;
    }

    return Boolean(findDeveloperIdApplicationIdentity());
}

export function assertMacReleaseSigningConfigured() {
    if (process.platform !== 'darwin') {
        throw new Error('macOS desktop release publishing must run on macOS so the signed DMG can be built and notarized.');
    }

    const missing = [];
    if (!hasMacSigningCertificate()) {
        missing.push(
            'a Developer ID Application certificate (set CSC_NAME/CSC_LINK or install the cert in Keychain)'
        );
    }
    if (!hasMacNotarizationCredentials()) {
        missing.push(
            'notarization credentials (APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_KEYCHAIN + APPLE_KEYCHAIN_PROFILE)'
        );
    }

    if (missing.length === 0) {
        return;
    }

    throw new Error(
        `macOS desktop release requires signed, notarized artifacts. Missing: ${missing.join('; ')}. See docs/releasing.md#macos-code-signing-and-notarization.`
    );
}

export function readCodesignAssessment(appPath) {
    const details = execFileSync('codesign', ['-dv', '--verbose=4', appPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const authority = [...details.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1]);
    const signatureLine = details.match(/^Signature=(.+)$/m)?.[1] ?? 'unknown';
    const teamIdentifier = details.match(/^TeamIdentifier=(.+)$/m)?.[1] ?? null;

    let gatekeeper = null;
    try {
        gatekeeper = execFileSync('spctl', ['-a', '-vv', '-t', 'install', appPath], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
    } catch (error) {
        gatekeeper = error.stderr?.toString?.() ?? String(error);
    }

    return {
        authority,
        signatureLine,
        teamIdentifier,
        gatekeeper,
        developerIdSigned: authority.some((entry) => entry.startsWith('Developer ID Application:')),
        adhocSigned: signatureLine === 'adhoc'
    };
}

export function defaultMacAppPath(repoRoot) {
    return path.join(repoRoot, 'dist', 'mac-arm64', 'Bygone.app');
}

export function verifyMacAppBundle(appPath, { requireNotarized = false } = {}) {
    if (!existsSync(appPath)) {
        throw new Error(`Missing macOS app bundle: ${appPath}`);
    }

    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
        stdio: 'inherit'
    });

    const assessment = readCodesignAssessment(appPath);
    if (!assessment.developerIdSigned) {
        throw new Error(
            `Expected Developer ID Application signing on ${appPath}, but saw Signature=${assessment.signatureLine}.`
        );
    }

    if (requireNotarized && !/accepted|Notarized Developer ID/.test(assessment.gatekeeper)) {
        throw new Error(
            `Gatekeeper did not accept ${appPath} as notarized:\n${assessment.gatekeeper}`
        );
    }

    return assessment;
}
