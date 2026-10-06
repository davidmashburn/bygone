# Capture record

Captured on macOS on 2026-10-06 from Bygone 0.9.9 (`e431a20`). The screenshots
are unretouched. Desktop captures use a 1440 × 900 window and retain Retina
resolution. Browser captures use a 1440 × 900 viewport, saved by the preview
host at 1280 × 800. VS Code captures retain its existing 1229 × 768 window.
The installed VS Code companion has different navigation chrome from Desktop;
the guide deliberately shows that distinction.

The small Parcel repository is original demonstration content, not a real
customer or private codebase. Generate it in a fresh temporary directory:

```sh
node docs/visual-walkthrough/create-demo.mjs /tmp/bygone-visual-demo
npm run compile
node docs/visual-walkthrough/capture-desktop.mjs /tmp/bygone-visual-demo
```

The desktop harness launches an isolated development app, invokes real controls,
and captures its web contents. Inspect regenerated captures before committing:
loading delays and host differences can otherwise produce blank screenshots.

| Image | Surface and capture state |
| --- | --- |
| 01 | Desktop: compare `release-v1.js` and `release-v5.js` |
| 02 | Desktop: compare all five versions; choose Visible panels → Fit |
| 03 | Desktop: compare the `before` and `after` directories (positional paths) |
| 04 | Desktop: two-file comparison; Search Comparison → `publish`, Visible panes |
| 05 | Desktop: repository history; Older commit once, showing added CHANGELOG |
| 06 | Desktop: `release.js` history; Older commit once |
| 07 | Desktop: review the fixture head against its first commit; Overview |
| 08 | Browser: present fixture `release.bygone`; initial document/scene overview |
| 09 | Browser: select Preview by default; scroll to the sticky scene heading |
| 10 | Browser: present `deconstructed-demo.bygone`; select Carry every anchor |
| 11 | Browser: from the fixture's first step, Files → release.yaml |
| 12 | Desktop: branch review → Historical tour, opening the missing-tour prompt |
| 13 | Browser: minimal embedded HTML export; first step; expand Tour details |
| 14 | VS Code: `src/workspaceHistory.ts` → Bygone: View Active File History |
| 15 | VS Code terminal: `node bin/bygone.js --help \| head -26` |

For browser captures, start `require('./cli/present').startPresentation(args,
repoRoot, process.cwd(), {open:false})` from Node in this checkout, then open the
returned localhost URL. The fixture tour uses its Parcel repository; the
checked-in deconstructed example uses this repository. Both contain pinned refs.

The portable example was produced with `tour export` using `--profile minimal
--runtime embedded`, then opened through a temporary static localhost server.
No external image or content service supplied these screenshots. No image
annotations were added: the guide's prose supplies the callouts.
