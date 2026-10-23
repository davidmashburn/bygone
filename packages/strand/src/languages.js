// JS and TS intentionally share a syntax family. Other languages never compete.
const TREE_SITTER_LANGUAGES = Object.freeze({});
function languageFor(path) {
    if (/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(path)) return 'javascript';
    if (/\.pyi?$/.test(path)) return 'python';
    if (/\.java$/.test(path)) return 'java';
    if (/\.go$/.test(path)) return 'go';
    if (/\.rs$/.test(path)) return 'rust';
    if (/\.(?:mojo|🔥)$/.test(path)) return 'mojo';
    return null;
}
const isTreeSitterSource = path => Object.hasOwn(TREE_SITTER_LANGUAGES, languageFor(path));
const isInferredSource = path => /\.(?:[cm]?[jt]s|[jt]sx|py)$/.test(path) || isTreeSitterSource(path);
module.exports = { languageFor, TREE_SITTER_LANGUAGES, isTreeSitterSource, isInferredSource };
