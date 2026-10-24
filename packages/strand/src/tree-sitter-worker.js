// Isolate asynchronous WASM parsing behind a bounded process. The public
// snapshot/matcher API stays synchronous, as with the CPython inventory.
const fs = require('node:fs');
const { parseSnapshots } = require('./tree-sitter-frontend');
(async () => {
    const input = fs.readFileSync(0, 'utf8');
    if (Buffer.byteLength(input) > 16 * 1024 * 1024) throw new Error('tree-sitter-input-budget');
    const request = JSON.parse(input);
    const result = await parseSnapshots(request.files, { strandFeatures: request.strandFeatures === true });
    process.stdout.write(JSON.stringify(result));
})().catch(() => { process.exitCode = 1; });
