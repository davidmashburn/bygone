import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    defaultMacAppPath,
    readCodesignAssessment,
    verifyMacAppBundle
} from './macos-signing.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultMacAppPath(repoRoot);
const requireNotarized = process.argv.includes('--require-notarized');

const assessment = requireNotarized
    ? verifyMacAppBundle(appPath, { requireNotarized: true })
    : readCodesignAssessment(appPath);

process.stdout.write(`Verified ${appPath}\n`);
process.stdout.write(`Signature: ${assessment.signatureLine}\n`);
if (assessment.teamIdentifier) {
    process.stdout.write(`TeamIdentifier: ${assessment.teamIdentifier}\n`);
}
if (assessment.authority.length > 0) {
    process.stdout.write(`Authority:\n${assessment.authority.map((entry) => `  - ${entry}`).join('\n')}\n`);
}
process.stdout.write(`Gatekeeper: ${assessment.gatekeeper}\n`);

if (!requireNotarized) {
    if (!assessment.developerIdSigned) {
        process.exitCode = 1;
        process.stderr.write(
            'Expected Developer ID Application signing. Unsigned/adhoc desktop builds show macOS "damaged" on download.\n'
        );
    }
}
