// JS and TS intentionally share a syntax family. Other languages never compete.
const TREE_SITTER_LANGUAGES = Object.freeze({
    csharp: { adapter: 'csharp', file: 'tree-sitter-c_sharp.wasm', version: '0.23.5', abi: 15,
        sha256: '6f69e1cae44e1c32c1eccc170dc5a9778fb94ff716f71113fe1f8c4299aa2f40' },
    ruby: { adapter: 'ruby', file: 'tree-sitter-ruby.wasm', version: '0.23.1', abi: 14,
        sha256: '09a96427d7c72f0613ed470cd9812223fc4a91d6a9c025c0235cc6bd59ff96f4' },
    php: { adapter: 'php', file: 'tree-sitter-php.wasm', version: '0.24.2', abi: 15,
        sha256: 'd4df6a6ff08c87c3ec4f9cbb785fe09998a0cb570e03f57d7b19b3acfb146aa7' },
    c: { adapter: 'c', file: 'tree-sitter-c.wasm', version: '0.24.1', abi: 15,
        sha256: 'c852c2a85ebf2beb636aa3b0ef7f7e70458684d74f6741b20dcb296885bed9f9' },
    lua: { adapter: 'lua', file: 'tree-sitter-lua.wasm', version: '0.4.1', abi: 15,
        sha256: '6d95607fc7d78964cfdf065ccb1ba76be5ed217c5ec0d0a3cace13c59fa1ae43' },
    go: { adapter: 'go', file: 'tree-sitter-go.wasm', version: '0.25.0', abi: 15,
        sha256: '9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7' },
    rust: { adapter: 'rust', file: 'tree-sitter-rust.wasm', version: '0.24.0', abi: 14,
        sha256: 'f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57' },
    mojo: { adapter: 'mojo', file: 'tree-sitter-mojo.wasm', version: 'e5905c480b9ebbeb4195032805781a5e535547f7', abi: 15, experimental: true,
        sha256: 'b5bdf5a4e16caced273927cec4ebfa4991c737f02e04a50487a61f08139c26f2' },
    java: { adapter: 'java', file: 'tree-sitter-java.wasm', version: '0.23.5', abi: 14,
        sha256: '4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4' }
});
function languageFor(path) {
    if (/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(path)) return 'javascript';
    if (/\.pyi?$/.test(path)) return 'python';
    if (/\.cs$/.test(path)) return 'csharp';
    if (/\.rb$/.test(path)) return 'ruby';
    if (/\.php$/.test(path)) return 'php';
    if (/\.c$/.test(path)) return 'c';
    if (/\.lua$/.test(path)) return 'lua';
    if (/\.java$/.test(path)) return 'java';
    if (/\.go$/.test(path)) return 'go';
    if (/\.rs$/.test(path)) return 'rust';
    if (/\.(?:mojo|🔥)$/.test(path)) return 'mojo';
    return null;
}
const isTreeSitterSource = path => Object.hasOwn(TREE_SITTER_LANGUAGES, languageFor(path));
const isInferredSource = path => /\.(?:[cm]?[jt]s|[jt]sx|py)$/.test(path) || isTreeSitterSource(path);
module.exports = { languageFor, TREE_SITTER_LANGUAGES, isTreeSitterSource, isInferredSource };
