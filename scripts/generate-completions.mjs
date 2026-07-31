import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { completionFileName, generateCompletion, SUPPORTED_SHELLS } = require('../cli/completions.js');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'completions');

await mkdir(outputDir, { recursive: true });
for (const shell of SUPPORTED_SHELLS) {
    const outputPath = path.join(outputDir, completionFileName(shell));
    await writeFile(outputPath, generateCompletion(shell), 'utf8');
    console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
}
