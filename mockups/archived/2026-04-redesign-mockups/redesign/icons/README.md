# Toolbar icons (vendored)

Icons are **[Lucide](https://lucide.dev)** static SVG files from **`lucide-static@0.462.0`** (ISC licence, upstream [lucide-icons/lucide](https://github.com/lucide-icons/lucide)).

Files were fetched from jsDelivr, e.g.  
`https://cdn.jsdelivr.net/npm/lucide-static@0.462.0/icons/<name>.svg`

Relative to mockup HTML, reference them as `./icons/lucide/<name>.svg`.

SVGs use `stroke="currentColor"`; when embedded with `<img>`, tint with CSS `filter:` on the `<img>` (see `icon-options.html` / `chrome-mockup.html`).

## Directory toolbar — selected set (Option A)

| Role | File |
|------|------|
| Expand all | `lucide/chevron-down.svg` |
| Collapse all | `lucide/chevron-right.svg` |
| Hide unchanged | `lucide/list-filter.svg` |

Mirrors folded-row affordances; third slot reads as **filtered list** (deltas only). Documented as “Option A — Outline” in `icon-options.html`.
