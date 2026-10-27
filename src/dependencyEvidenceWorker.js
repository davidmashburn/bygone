// Process boundary lets the caller enforce time/output budgets for compiler and WASM parsing.
/* global require, process */
const fs = require('fs');
(async () => {
    const { files } = JSON.parse(fs.readFileSync(0, 'utf8'));
    const result = process.argv[2] === 'typescript'
        ? require('./dependencyTypescript.js').analyzeTypescriptDependencies(files)
        : await require('./dependencyParsers.js').analyzeParserDependencies(files);
    process.stdout.write(JSON.stringify(result));
})().catch(error => { process.stderr.write(String(error.message)); process.exitCode = 1; });
