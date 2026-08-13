# Monaco editor comfort

## Status

Implemented on `main` by `91dc637` for editor comfort, source-aware models, and
folding. The optional browser language-service phase was measured and deferred;
its worker cost does not fit the current extension artifact budget.

## Implementation outcome

- Bygone imports a curated set of Monaco editing contributions rather than the
  complete editor bundle.
- Two-way and multi-panel editors use owned `ITextModel` instances with internal
  `bygone://model/` URIs, bounded language IDs, explicit replacement, and model
  disposal.
- Folding is enabled. Change navigation unfolds enclosing regions before it
  reveals a change, and hidden-area changes schedule connector redraws.
- The standalone app exposes Selection and Lines menus backed by allowlisted
  Monaco actions. Change navigation uses `F7`, `Shift+F7`, and simultaneous
  `Cmd/Ctrl+Shift+Up/Down`; Monaco regains `Cmd/Ctrl+Alt+Up/Down` for cursors.
- The resulting renderer is about 3,748 KiB and the VSIX runtime is 4.9 MiB
  against its existing 5 MiB cap. Tests, type checking, lint, bundle checks,
  VSIX contents, and all three desktop smoke modes pass.

The optional language-service measurement produced workers of about 6.7 MiB
for JavaScript/TypeScript, 404 KiB for JSON, 715 KiB for HTML, and 1.0 MiB for
CSS. The TypeScript worker alone exceeds the current full VSIX budget. Do not
ship these services until they can be lazy-loaded outside the core artifact,
the product adopts a materially larger package budget, or a smaller service
boundary is demonstrated. Syntax and language configuration remain built in.

## Goal

Make editing inside Bygone feel like a familiar code editor while preserving
Bygone's matching, connectors, synchronized scrolling, change navigation,
multi-panel layout, history, and tours.

The first release focuses on capabilities Monaco already contains:

- multi-cursor and multi-line editing;
- familiar selection, line, comment, indentation, and clipboard commands;
- language-aware syntax, brackets, comments, and indentation;
- a conventional context menu and desktop Edit/Selection menus; and
- shortcuts that do not conflict with standard editor behavior.

This plan does not require VS Code `TextDocument` subclassing, language servers,
or a bridge to installed VS Code extensions.

## Technical boundary

VS Code's `TextDocument` is an interface implemented and owned by VS Code. It
cannot be constructed or subclassed by Bygone, and it is unavailable in the
standalone app. A VS Code `CustomTextEditorProvider` would still render a
webview; it would not turn Bygone's panes into native VS Code editors.

Use Monaco's normal composition instead:

- `ITextModel` owns text, language identity, edits, and undo data;
- `IStandaloneCodeEditor` renders and edits a model; and
- Bygone owns comparison state and host persistence around those objects.

Create source-aware models and attach them to editors. Do not subclass Monaco
internals; only `monaco.d.ts` is a supported public API.

## Current gap

Bygone currently imports the minimal Monaco editor API plus Find. It creates
anonymous `plaintext` editors and explicitly disables folding. Many familiar
features exist in the installed Monaco package but their editor contributions
and language configurations are not imported.

Bygone also assigns `Cmd/Ctrl+Alt+Up/Down` to previous/next change. Monaco and
VS Code users commonly expect those shortcuts to add cursors above and below.
The comfort pass returns that key space to Monaco.

An isolated bundle comparison—not a final Bygone build—measured:

| Monaco load | Minified JavaScript | Gzipped |
| --- | ---: | ---: |
| Current minimal API plus Find | about 2.5 MB | about 674 KB |
| All editor contributions | about 3.4 MB | about 926 KB |
| Contributions plus a small language set | about 3.6 MB | about 989 KB |

Prefer a curated contribution list over importing every editor feature. Record
the real Bygone bundle and artifact changes before adjusting package budgets.

## Phase 1: editor operations and shortcuts

### Monaco contributions

Import and enable the public editor contributions needed for:

- multiple cursors and column selection;
- add cursor above/below;
- add selection to next/previous match and select all occurrences;
- move and copy lines up/down;
- delete, join, transpose, and insert lines above/below;
- indent, outdent, and reindent selections;
- toggle line and block comments;
- expand and shrink selection;
- bracket matching and jump to bracket;
- cursor undo;
- word and subword navigation;
- drag-and-drop editing; and
- normal clipboard and context-menu behavior.

Import individual supported contribution modules or a measured curated entry
module. Avoid private implementation imports whose behavior is not exposed by
Monaco's public API.

### Change-navigation shortcuts

Support both a conventional function-key binding and a simultaneous modifier
shortcut:

- **Next change:** `F7`
- **Previous change:** `Shift+F7`
- **Next change:** `Cmd/Ctrl+Shift+Down`
- **Previous change:** `Cmd/Ctrl+Shift+Up`

The arrow binding is one keypress, not a sequential two-step chord. The extra
`Shift` modifier keeps the gesture easy to perform while avoiding Monaco's
standard `Cmd/Ctrl+Alt+Up/Down` multi-cursor bindings. Document that Bygone
intentionally reserves this combination while a comparison pane is focused;
selection to a document boundary remains available through Monaco's other
selection commands and menus.

Retire `Cmd/Ctrl+Alt+Up/Down` for change navigation and allow Monaco to use it
for add-cursor-above/below where platform conventions apply. Keep toolbar
buttons and menu commands available so neither F-keys nor chords are required.

The status/help text and keyboard-shortcut documentation should show both
change-navigation alternatives. Avoid adding a new permanent hint to every
pane if the existing toolbar tooltip and shortcut documentation suffice.

### Menus

Keep the conventional Edit menu and add a Selection submenu or appropriate
menu placement for:

- Add Cursor Above/Below
- Add Selection to Next/Previous Match
- Select All Occurrences
- Move Line Up/Down
- Copy Line Up/Down
- Delete Line
- Insert Line Above/Below
- Toggle Line Comment
- Toggle Block Comment
- Indent/Outdent Line
- Expand/Shrink Selection

Route commands to the active Monaco editor. Writability rules remain
authoritative: selection, copy, and navigation may work in read-only panes;
mutating commands disable or no-op there.

### Suggested editor configuration

Start from Monaco defaults and set only deliberate Bygone choices:

```javascript
{
    autoIndent: 'full',
    detectIndentation: true,
    autoClosingBrackets: 'languageDefined',
    autoClosingQuotes: 'languageDefined',
    autoClosingComments: 'languageDefined',
    autoSurround: 'languageDefined',
    matchBrackets: 'always',
    bracketPairColorization: { enabled: true },
    guides: {
        indentation: true,
        bracketPairs: true,
        highlightActiveIndentation: true
    },
    multiCursorModifier: 'alt',
    multiCursorPaste: 'spread',
    dragAndDrop: true,
    contextmenu: true,
    copyWithSyntaxHighlighting: true,
    links: true,
    mouseWheelZoom: true,
    renderWhitespace: 'selection',
    renderFinalNewline: 'dimmed',
    wordBasedSuggestions: 'currentDocument',
    quickSuggestions: false
}
```

Do not copy VS Code's entire settings surface. Add a Bygone preference only
when users need to choose behavior rather than inherit a sensible default.

## Phase 2: source-aware models and language presentation

Create a Monaco model for each textual pane with content, language ID, and a
stable internal URI, then pass the model to the editor:

```javascript
const model = monaco.editor.createModel(
    content,
    languageId,
    monaco.Uri.parse(modelUri)
);

const editor = monaco.editor.create(container, {
    model,
    // shared comfort options
});
```

The internal URI must not expose source content, credentials, or unnecessary
absolute paths. Dispose models when their owning pane/session closes.

Start with a bounded language set:

- JavaScript and TypeScript
- JSON
- HTML and CSS
- Markdown
- YAML
- Python
- shell scripts
- plaintext fallback

For the VS Code extension, use `TextDocument.languageId` for document-backed
panes. For standalone files, infer from the original path with one tested map.
Allow an explicit language override only after a real use case appears.

Language configuration supplies useful behavior without a language server:

- syntax highlighting;
- comment syntax;
- automatic brackets and quotes;
- indentation and outdent rules;
- word boundaries; and
- basic folding ranges.

Initially keep folding disabled in production. Test it separately because
collapsed lines alter visible geometry used by connectors, synchronized
scrolling, active-change revelation, and tour anchors. Enable it only after
those interactions remain correct.

## Phase 3: optional built-in language services

After the comfort and syntax passes ship, evaluate Monaco's bundled browser
language services for:

- JavaScript and TypeScript;
- JSON;
- HTML; and
- CSS.

Possible features include completion, diagnostics, hover, formatting, and
document symbols. Treat these as file-oriented assistance, not full workspace
or installed-extension parity. Measure dedicated worker cost, import behavior,
project configuration expectations, and compatibility across desktop, VS Code
webview, and browser presenter before committing to the phase.

Python, Rust, Go, and arbitrary languages remain syntax-only unless a separate
LSP plan is approved.

## Explicit non-goals

- Subclassing or reproducing VS Code `TextDocument`
- Mirroring every installed VS Code language provider into Monaco
- General-purpose Language Server Protocol support
- Arbitrary extension commands, CodeLens, inline chat, debugging, or refactors
- Workspace-wide rename and multi-file code actions
- Replacing Bygone's renderer with Monaco's stock diff editor
- Claiming that standalone has the full VS Code editing ecosystem

## Delivery order and estimates

1. **Editor comfort pass:** contributions, menus, shortcuts, and configuration;
   roughly 3–7 engineering days.
2. **Language presentation pass:** source-aware models and bounded language
   configuration; roughly 4–8 engineering days.
3. **Folding decision:** focused connector/navigation experiment; roughly 1–3
   engineering days.
4. **Optional browser language services:** separately scoped after measurement;
   roughly 1–3 engineering weeks for a disciplined first slice.

The first two phases should be independently releasable. Do not delay basic
multi-line editing and familiar shortcuts for language-service work.

## Verification

Use only Bygone-owned open-source fixtures.

### Editor behavior

- multi-cursor mouse gestures and add-cursor-above/below;
- select-next, select-previous, and select-all occurrences;
- move/copy/delete/insert lines with one or many selections;
- comment, indent, outdent, bracket, selection expansion, and drag/drop;
- undo/redo after each operation;
- read-only command gating;
- `F7`, `Shift+F7`, `Cmd/Ctrl+Shift+Down`, and `Cmd/Ctrl+Shift+Up`;
- no collision between change navigation, multi-cursor, copy/move line, Find,
  Replace, word wrap, save, or host shortcuts; and
- menu and context-menu focus routing in two-way and multi-panel modes.

### Comparison behavior

- diff recomputation after multi-cursor and multi-line edits;
- connector redraw and synchronized scrolling;
- active change and selection preservation;
- copy-across after line operations;
- find/replace and visible search after edits;
- history, tour, and synthetic panes remain read-only; and
- no regression in focused multi-panel navigation.

### Language behavior

- correct language mapping and plaintext fallback;
- comments, indentation, brackets, quotes, and word boundaries per language;
- CRLF, Unicode, tabs, long lines, and no-final-newline files;
- model disposal and session switching;
- measured renderer, worker, VSIX, desktop, npm, and presenter artifact size;
  and
- folding geometry if folding is considered for release.

Run the TypeScript compiler, lint, full automated suite, bundle budgets, VSIX
allowlist check, desktop smoke matrix, and manual Extension Development Host
matrix.

## Acceptance criteria

- Editing multiple lines and occurrences feels familiar without leaving the
  Bygone comparison.
- Monaco's standard multi-cursor shortcuts are not displaced by Bygone
  navigation; the documented `Cmd/Ctrl+Shift+Up/Down` exception is deliberate.
- Change navigation is available through buttons, menus, F-keys, and the
  simultaneous `Cmd/Ctrl+Shift+Up/Down` arrow shortcuts.
- Supported files receive useful language-aware syntax and editing behavior
  without starting external processes.
- Unsupported files remain stable plaintext editors.
- Read-only provenance and mutation rules remain unchanged.
- Bygone's matching, connectors, scrolling, navigation, multi-panel layout,
  history, and tours remain correct.
- Bundle growth is measured, justified, and kept within checked budgets.

## Related plans

- [Standalone product surface](standalone-product-surface.md)
- [VS Code companion surface](vscode-companion-surface.md)
- [Text wrap option](text-wrap-option.md)
- [Focused multi-panel strip](focused-multi-panel-strip.md)
- [Diff matching between panels](diff-matching-between-panels.md)
