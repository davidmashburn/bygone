const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSnapshots } = require('../src/tree-sitter-frontend');
const { languageFor } = require('../src/languages');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');

test('shared frontend validates snapshot input and handles empty input', async () => {
    await assert.rejects(parseSnapshots({ 'bad.java': null }), /invalid-snapshot-text/);
    assert.deepEqual(Object.keys((await parseSnapshots({})).documents), []);
});

test('language domains include future adapters and prevent exact cross-language matches', () => {
    assert.deepEqual(['a.java', 'a.go', 'a.rs', 'a.mojo', 'a.🔥'].map(languageFor), ['java', 'go', 'rust', 'mojo', 'mojo']);
    const result = analyzeStrand({ 'a.js': 'function price(items) { return items.length + 1; }' },
        { 'a.py': 'def price(items):\n    return len(items) + 1\n' });
    assert.equal(result.analysis.relations.length, 0);
});

test('parser timeout fails closed without exact or inferred relations', () => {
    const code = 'class Cart { int value() { return 8; } }';
    const result = analyzeStrand({ 'a.java': code }, { 'a.java': code }, { treeSitterTimeoutMs: 1 });
    assert.equal(result.native.reason, 'parse-preflight-failed');
    assert.equal(result.analysis.relations.length, 0);
    assert(result.analysis.inventories.before.documents[0].diagnostics.some(d => d.message.includes('timeout')));
});

test('all shipped grammar bytes match registry hashes and declared parser ABI', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { createHash } = require('node:crypto');
    const { TREE_SITTER_LANGUAGES } = require('../src/languages');
    const { loadLanguage } = require('../src/tree-sitter-frontend');
    for (const [id, config] of Object.entries(TREE_SITTER_LANGUAGES)) {
        const bytes = fs.readFileSync(path.join(__dirname, '../src/grammars', config.file));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), config.sha256, id);
        assert.equal((await loadLanguage(id)).abiVersion, config.abi, id);
    }
});

test('corrupted grammar bytes are rejected before loading', () => {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, ['-e', `
        const fs = require('node:fs');
        const read = fs.readFileSync;
        fs.readFileSync = function(file, ...args) {
            if (String(file).endsWith('grammars/tree-sitter-java.wasm')) return Buffer.from('corrupted');
            return read.call(this, file, ...args);
        };
        require('./src/tree-sitter-frontend').loadLanguage('java').then(
            () => { process.exitCode = 1; },
            error => { if (error.message !== 'grammar-digest-mismatch') { console.error(error); process.exitCode = 2; } }
        );
    `], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
});

test('invalid parser resource overrides fail closed and excessive values are capped', () => {
    const { boundedProcessOptions, LIMITS } = require('../src/input');
    for (const [extension, text, prefix] of [
        ['java', 'class Item { int value() { return 9; } }', 'treeSitter'],
        ['py', 'def value():\n    return 9\n', 'python']
    ]) {
        for (const key of [`${prefix}TimeoutMs`, `${prefix}MaxOutputBytes`]) {
            for (const value of [-1, 0, 1.5, NaN, Infinity, '100', null]) {
                const files = { [`a.${extension}`]: text };
                const result = analyzeStrand(files, files, { [key]: value });
                assert.equal(result.native.reason, 'parse-preflight-failed', `${key}: ${value}`);
                assert.equal(result.analysis.relations.length, 0);
                assert.match(result.analysis.inventories.before.documents[0].diagnostics[0].message, /invalid-.*parser-options/);
            }
        }
    }
    assert.deepEqual(boundedProcessOptions({ treeSitterTimeoutMs: Number.MAX_SAFE_INTEGER,
        treeSitterMaxOutputBytes: Number.MAX_SAFE_INTEGER }, 'treeSitterTimeoutMs', 'treeSitterMaxOutputBytes', 30000),
    { timeout: 30000, maxBuffer: LIMITS.maxOutputBytes });
});
