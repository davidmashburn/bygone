# Pinned parser assets

These parsers run with `web-tree-sitter@0.27.1` (ABI 13–15). The registry in
`../languages.js` pins every asset's SHA-256 and the frontend checks it before
loading. Runtime installs use these local assets, never downloads or native
Node addons. Each upstream license is retained beside its asset.

| Language | Upstream / release | Origin | ABI |
| --- | --- | --- | --- |
| Go | [tree-sitter-go](https://github.com/tree-sitter/tree-sitter-go), 0.25.0 | `tree-sitter-go@0.25.0` npm tarball, `package/tree-sitter-go.wasm` | 15 |
| Rust | [tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust), 0.24.0 | `tree-sitter-rust@0.24.0` npm tarball, `package/tree-sitter-rust.wasm` | 14 |
| Mojo (experimental) | [tree-sitter-mojo](https://github.com/lsh/tree-sitter-mojo/commit/e5905c480b9ebbeb4195032805781a5e535547f7), `e5905c480b9ebbeb4195032805781a5e535547f7` | Built from pinned source, see below | 15 |
| C# | [tree-sitter-c-sharp](https://github.com/tree-sitter/tree-sitter-c-sharp), 0.23.5 | `tree-sitter-c-sharp@0.23.5` npm tarball, `package/tree-sitter-c_sharp.wasm` | 15 |
| Ruby | [tree-sitter-ruby](https://github.com/tree-sitter/tree-sitter-ruby), 0.23.1 | `tree-sitter-ruby@0.23.1` npm tarball, `package/tree-sitter-ruby.wasm` | 14 |
| PHP | [tree-sitter-php](https://github.com/tree-sitter/tree-sitter-php), 0.24.2 | `tree-sitter-php@0.24.2` npm tarball, `package/tree-sitter-php.wasm` | 15 |
| C | [tree-sitter-c](https://github.com/tree-sitter/tree-sitter-c), 0.24.1 | `tree-sitter-c@0.24.1` npm tarball, `package/tree-sitter-c.wasm` | 15 |
| Lua | [tree-sitter-lua](https://github.com/tree-sitter-grammars/tree-sitter-lua), 0.4.1 | `@tree-sitter-grammars/tree-sitter-lua@0.4.1` npm tarball, `package/tree-sitter-lua.wasm` | 15 |
| Java | [tree-sitter-java](https://github.com/tree-sitter/tree-sitter-java), 0.23.5 | `tree-sitter-java@0.23.5` npm tarball, `package/tree-sitter-java.wasm` | 14 |

To reproduce the Java asset, run `npm pack tree-sitter-java@0.23.5` in a temporary
directory and extract the indicated file without installing or running package
scripts. Compare its SHA-256 with the registry before copying it here. The
0.23.5 official prebuilt loads successfully on the pinned runtime despite its
older ABI. No RefactoringMiner code or JVM is included in this package.

The Go asset is copied in the same way from `npm pack tree-sitter-go@0.25.0`.

The Rust asset is copied from `npm pack tree-sitter-rust@0.24.0`.
The C#, Ruby, PHP, C and Lua assets are likewise extracted from the exact npm
tarballs listed above, with their MIT licenses. Package install scripts are not
run, and native prebuilds and query files are not shipped.

Mojo is built from that exact source commit using Tree-sitter CLI 0.27.1,
WASI SDK 34.0 and Binaryen 132. With those tools downloaded separately and
verified, run from a temporary build directory (paths are examples):

```sh
git clone https://github.com/lsh/tree-sitter-mojo.git mojo-source
git -C mojo-source checkout e5905c480b9ebbeb4195032805781a5e535547f7
TREE_SITTER_WASI_SDK_PATH="$PWD/wasi-sdk-34.0" \
TREE_SITTER_BINARYEN_PATH="$PWD/binaryen-132" \
  ./tree-sitter-0.27.1 build --wasm mojo-source -o tree-sitter-mojo.wasm
```

The CLI compiles `src/parser.c` and `src/scanner.c` with WASI clang (`-Os`),
then optimizes with `wasm-opt -Os`. Compare the output hash to the registry.
The shipped parser is MIT licensed. Upstream's MPL-2.0 query files are not
included or used in this build. Runtime users need no build toolchain.
