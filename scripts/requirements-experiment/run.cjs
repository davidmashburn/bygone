const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-requirements-'));
const corePath = path.join(root, 'out/requirements.js');
execFileSync(process.execPath, ['--test', path.join(root, 'test/requirements.test.js'), path.join(root, 'packages/strand/test/source-references.test.js')], { stdio: 'inherit' });
const result = require('./demo.cjs').demo(root, output, require(corePath));
console.log(JSON.stringify(result, null, 2));
