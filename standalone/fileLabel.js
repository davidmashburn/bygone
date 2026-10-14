/* global module, require */
const path = require('path');

function revisionFileLabel(filePath, revision) {
    const directory = path.dirname(filePath);
    return `${path.basename(filePath)} @ ${revision}${directory === '.' ? '' : ` · ${directory}`}`;
}

module.exports = { revisionFileLabel };
