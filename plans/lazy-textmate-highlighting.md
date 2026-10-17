# Lazy-loaded TextMate syntax highlighting

## Status

Deferred implementation plan, captured 2026-10-16. Ship the focused Monaco
Python tokenizer correction first. Revisit this plan when broader syntax
fidelity justifies a new runtime subsystem; the current Python defect alone
does not.

## Goal

Give Bygone VS Code-grade syntax highlighting from TextMate grammars without
adding the TextMate engine, Oniguruma, and every grammar to the initial renderer
bundle. Preserve fast startup and offline operation in Desktop, the VS Code
webview, web presentation, and self-contained exports.

This work concerns lexical highlighting only. It does not add language servers,
semantic tokens, diagnostics, completion, formatting, or execution.

## Evidence and current decision

Monaco 0.55's bundled Python Monarch grammar treats triple-quoted f-strings as
single-line strings. A focused local provider fixes that state transition and
has regression coverage for multiline `f"""..."""` and `f'''...'''` strings,
raw/f-string prefix order, interpolation, escaped delimiters, and the Python
code following each closing delimiter. That is the proportionate release fix.

A temporary feasibility probe used `vscode-textmate` 9.3.2,
`vscode-oniguruma` 2.0.1, and the Python grammar distributed by
`@shikijs/langs` 4.5.0. It was not committed and did not alter the product.
On the development machine:

- the reported two-function Python sample retained string scopes through both
  multiline f-strings and resumed Python scopes after each closing delimiter;
- the encoded-token contract required by Monaco passed, including state
  cloning/equality and the configured encoded language ID;
- module loading, WASM initialization, grammar loading, and first tokenization
  took about 44 ms in the Node probe;
- a 644 KB, 14,000-line multiline sample tokenized in about 227 ms after
  warm-up; a deliberately dense 400 KB fixture with an f-string on every line
  had a 303 ms median over seven encoded-token runs;
- a minified browser bundle containing the engine, WASM, and Python grammar was
  783,134 bytes raw and 270,399 bytes gzip. The 473,151-byte Oniguruma WASM was
  the largest input.

These measurements establish feasibility, not production performance. They did
not measure scrolling and retokenization in the sandboxed Electron renderer,
arbitrary host themes, CSP behavior, or multiple simultaneously visible large
files. The existing `media/webview.js` budget has roughly 60 KB of headroom, so
the measured stack must not be folded into that initial bundle.

## Proposed architecture

### 1. Keep language identity and editing configuration in the core renderer

Register supported language IDs, filename associations, brackets, comments,
indentation, and auto-closing behavior during normal renderer startup. A
TextMate provider replaces only lexical tokenization. Existing Monarch
providers remain the fallback until each language is explicitly migrated.

Use Monaco's public encoded-token provider contract:

- `languages.registerTokensProviderFactory` for first-use activation;
- `languages.getEncodedLanguageId` for grammar configuration;
- `vscode-textmate.Registry.loadGrammarWithConfiguration`;
- `grammar.tokenizeLine2` with TextMate rule stacks as Monaco end states.

Do not depend on Monaco internals or the abandoned Onigasm-era adapter packages.

### 2. Load one shared engine and grammar chunks on demand

Build a separately budgeted TextMate runtime containing `vscode-textmate` and
`vscode-oniguruma`. Load and initialize it once when the first migrated
language is shown. Load grammar data independently by language so adding
coverage does not make every first-use request pay for all grammars.

Start with Python because it has a concrete regression fixture. The first
production slice may combine the engine, WASM, and Python grammar in one lazy
artifact if that materially simplifies offline delivery; retain boundaries in
the source so later grammars can share the initialized engine.

Every host must supply resolved runtime URLs rather than allowing renderer code
to infer filesystem or extension paths. Failures should leave readable
plaintext or the existing Monarch provider and report one bounded diagnostic;
they must not prevent editors or diffs from opening.

### 3. Treat themes as part of tokenization

TextMate encoded tokens contain color-map indexes. Bundle controlled light,
dark, and high-contrast token themes and pass each registry color map through
Monaco's `encodedTokensColors` theme field while retaining current host-derived
editor chrome colors.

The current host bridge exposes CSS variables, not an arbitrary VS Code theme's
complete TextMate token rules. Exact parity with every installed VS Code theme
is therefore out of scope for the first slice. On appearance changes, replace
the registry/provider state and force affected models to retokenize; do not
reuse rule stacks created under an old registry theme.

### 4. Preserve all delivery surfaces

Ship lazy artifacts through:

- VSIX allowlists and `webview.asWebviewUri`;
- Desktop packaging and its sandboxed preload bridge;
- npm runtime packaging;
- versioned web/CDN assets and integrity metadata;
- embedded HTML exports using verified blob URLs.

Initialize Oniguruma from explicit bytes rather than relying on
`WebAssembly.instantiateStreaming`, MIME configuration, or `file://` fetches.
Add only the CSP capability required for WASM compilation and resolved local
assets. Do not add general network access, Node integration, or `unsafe-eval`.
Include grammar, theme, TextMate, and Oniguruma licenses in shipped notices.

## Implementation sequence

1. Build an unshipped browser/Electron prototype that registers Python through
   the encoded-token provider and runs in the real Monaco renderer.
2. Measure cold first-Python display, edit retokenization, rapid scrolling, and
   several visible large Python revisions. Set explicit initial and lazy bundle
   budgets from those results.
3. Define light, dark, and high-contrast token themes and verify appearance
   changes discard old token states.
4. Wire the artifact through VS Code, Desktop, web, npm, CDN, and embedded
   export packaging with integrity and offline checks.
5. Release Python behind the normal provider path. Keep its focused Monarch
   implementation available for one release as a rollback, then remove it if
   runtime evidence is clean.
6. Evaluate additional languages individually. Prefer migrations that fix
   demonstrated fidelity gaps; do not adopt a large grammar catalog merely
   because it is available.

## Validation

- Scope fixtures cover multiline strings, interpolation, malformed/incomplete
  source, comments, decorators, annotations, regular expressions, and code
  following stateful constructs.
- Encoded-token tests cover language IDs, font styles, token types, color IDs,
  state cloning/equality, edits that invalidate preceding state, and provider
  replacement after a theme change.
- Renderer tests inspect actual Monaco token spans and colors in light, dark,
  and high contrast; screenshots alone are insufficient.
- Performance fixtures cover a normal source file, long lines, large diffs,
  rapid scrolling, editing near the top of a file, and three/four-panel views.
- Offline smoke tests cover packaged Desktop, VSIX webviews, embedded exports,
  and npm-installed Desktop. CDN exports verify pinned integrity and a clear
  failure message when the network is unavailable.
- Existing Monarch languages retain their token colors and behavior while the
  mixed backend is in service.

## Exit criteria

- No TextMate code or grammar is downloaded or initialized until a migrated
  language is displayed.
- First-use latency and retokenization remain below thresholds selected from
  the real-renderer prototype; thresholds and test hardware are recorded before
  implementation approval.
- Lazy assets have explicit raw and compressed budgets, and the initial
  `media/webview.js` budget is not raised to absorb them.
- Every supported delivery surface works offline where it does today, includes
  required notices, and fails safely when a lazy asset cannot load.
- Python highlighting is at least as correct as the focused Monarch regression
  suite, including the original multiline f-string report.

## Non-goals

- Full VS Code extension-host compatibility.
- Worker-backed tokenization before profiling demonstrates a main-thread
  problem.
- Semantic highlighting or Python language intelligence.
- Immediate migration of every Monaco basic language.
- Exact reproduction of arbitrary installed VS Code themes in surfaces that do
  not receive their complete token rules.
