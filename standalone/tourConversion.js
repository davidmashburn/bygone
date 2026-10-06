/* global require, module */
const fs = require('fs');
const path = require('path');
const { readTourSourceText, parseTourSourceText, inspectTourConversion, convertTourSourceText } = require('../cli/tourFile.js');

async function loadTourWithConversion(cwd, sourcePath, dialog, owner) {
    const resolvedPath = path.resolve(cwd, sourcePath);
    const text = readTourSourceText(resolvedPath);
    const conversion = inspectTourConversion(text, resolvedPath);
    if (!conversion) return { resolvedPath, source: parseTourSourceText(text, resolvedPath) };
    const options = {
        type: 'question', title: 'Convert older tour', message: conversion.message,
        detail: `${conversion.detail}\n\nA new .v4 copy will be saved beside:\n${resolvedPath}`,
        buttons: ['Convert and open copy', 'Cancel'], defaultId: 0, cancelId: 1
    };
    const answer = await (owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options));
    if (answer.response !== 0) return null;
    if (readTourSourceText(resolvedPath) !== text) {
        throw new Error('The tour changed while conversion was pending. Open it again to convert the latest version.');
    }
    const converted = convertTourSourceText(text, resolvedPath);
    const suffix = resolvedPath.match(/(?:\.bygone)?\.ya?ml$|\.bygone$/i)?.[0] || '.bygone';
    const stem = resolvedPath.endsWith(suffix) ? resolvedPath.slice(0, -suffix.length) : resolvedPath;
    for (let index = 1; index <= 1000; index++) {
        const destination = `${stem}.v4${index === 1 ? '' : `-${index}`}${suffix}`;
        try {
            fs.writeFileSync(destination, converted.text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
            return { resolvedPath: destination, source: converted.source };
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
    throw new Error('Could not find an unused filename for the converted tour.');
}

module.exports = { loadTourWithConversion };
