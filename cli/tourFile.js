const { readFileSync } = require('fs');
const path = require('path');
const { load: loadYaml } = require('js-yaml');
const { buildChangeTourManifest, parseChangeTourSource } = require('../out/changeTour.js');

function loadTourSource(cwd, sourcePath) {
    const resolvedPath = path.resolve(cwd, sourcePath);
    const source = parseChangeTourSource(loadYaml(readFileSync(resolvedPath, 'utf8')));
    return { resolvedPath, source };
}

function buildManifestForTourSource(cwd, source, options = {}) {
    return buildChangeTourManifest(cwd, {
        headRef: options.headRef || source.range?.head,
        baseRef: options.baseRef || source.range?.base,
        title: options.title,
        sourceUrl: options.sourceUrl,
        generatedAt: options.generatedAt,
        source
    });
}

module.exports = {
    buildManifestForTourSource,
    loadTourSource
};
