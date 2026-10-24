const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
// Hash executable source plus the pinned grammar registry. Grammar bytes are
// checked against that registry at load time; no source paths leak into output.
function implementationIdentity() {
    const files = [];
    function visit(directory, prefix = '') {
        for (const name of fs.readdirSync(directory).sort()) {
            const file = path.join(directory, name), key = prefix + name;
            if (fs.statSync(file).isDirectory()) visit(file, key + '/');
            else if (/\.(?:js|py)$/.test(name)) files.push([key, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
        }
    }
    visit(__dirname);
    return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}
module.exports = { implementationIdentity };
