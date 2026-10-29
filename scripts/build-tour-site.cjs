#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { verifyPackage } = require('./package-tour.cjs');
const root = path.resolve(__dirname, '..');
const destination = path.resolve(process.argv[2] || '.tour-site');
if (fs.existsSync(destination)) throw new Error('Site output exists; choose a fresh output directory');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/tours/releases.json')));
const versions = new Set();
const releases = catalog.versions.map(release => {
    if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(release.version) || versions.has(release.version)) throw new Error('Invalid or duplicate version');
    versions.add(release.version);
    const directory = path.join(root, 'docs/tours/product', release.version);
    const manifest = verifyPackage(directory);
    if (manifest.digest !== release.digest) throw new Error('Approved release digest changed');
    return { directory, version: release.version, manifest };
});
if (!versions.has(catalog.current)) throw new Error('Current release missing');
fs.mkdirSync(destination, { recursive: true });
for (const { directory, version, manifest } of releases) {
    const target = path.join(destination, 'tours/product', version);
    fs.mkdirSync(target, { recursive: true });
    // An explicit allowlist: never copy a repository, docs tree, or arbitrary uploads.
    for (const name of [...Object.keys(manifest.artifacts), 'manifest.json', 'README.md']) {
        const file = path.join(directory, name);
        if (!fs.lstatSync(file).isFile()) throw new Error(`Not a regular file: ${name}`);
        fs.copyFileSync(file, path.join(target, name));
    }
}
fs.copyFileSync(path.join(root, 'docs/tours/site/index.html'), path.join(destination, 'index.html'));
fs.writeFileSync(path.join(destination, '.nojekyll'), '');
fs.writeFileSync(path.join(destination, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Tour not found</title><h1>Tour not found</h1><p>This version or file is unavailable. Check the original link.</p></html>');
console.log(`Prepared ${releases.length} version(s) in ${destination}; nothing published.`);
