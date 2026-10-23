// JS and TS intentionally share a syntax family. Other languages never compete.
const TREE_SITTER_LANGUAGES = Object.freeze({
    go: { adapter: 'go', file: 'tree-sitter-go.wasm', version: '0.25.0', abi: 15,
        sha256: '9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7' },
    java: { adapter: 'java', file: 'tree-sitter-java.wasm', version: '0.23.5', abi: 14,
        sha256: '4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4' }
});
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
