# Pinned parser assets

These parsers run with `web-tree-sitter@0.27.1` (ABI 13–15). The registry in
`../languages.js` pins every asset's SHA-256 and the frontend checks it before
loading. Runtime installs use these local assets, never downloads or native
Node addons. Each upstream license is retained beside its asset.

| Language | Upstream / release | Origin | ABI |
| --- | --- | --- | --- |
| Go | [tree-sitter-go](https://github.com/tree-sitter/tree-sitter-go), 0.25.0 | `tree-sitter-go@0.25.0` npm tarball, `package/tree-sitter-go.wasm` | 15 |
| Rust | [tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust), 0.24.0 | `tree-sitter-rust@0.24.0` npm tarball, `package/tree-sitter-rust.wasm` | 14 |
| Java | [tree-sitter-java](https://github.com/tree-sitter/tree-sitter-java), 0.23.5 | `tree-sitter-java@0.23.5` npm tarball, `package/tree-sitter-java.wasm` | 14 |

To reproduce the Java asset, run `npm pack tree-sitter-java@0.23.5` in a temporary
directory and extract the indicated file without installing or running package
scripts. Compare its SHA-256 with the registry before copying it here. The
0.23.5 official prebuilt loads successfully on the pinned runtime despite its
older ABI. No RefactoringMiner code or JVM is included in this package.

The Go asset is copied in the same way from `npm pack tree-sitter-go@0.25.0`.

The Rust asset is copied from `npm pack tree-sitter-rust@0.24.0`.
