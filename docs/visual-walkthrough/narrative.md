# Bygone, one screen at a time

Bygone connects three activities: comparing concrete files, investigating their
history, and explaining what you found. This guide starts with the diff itself,
then follows those activities through the shared window. Each stop pairs a real
screenshot with a specific thing to notice. Screens are examples, not live
controls; open the matching workflow to explore your own files.

## Compare what is in front of you

### Two files, one visual comparison

Start with two files when you already know what belongs on each side. Blue
regions connect corresponding changed text; green regions mark content present
on only one side. The ribbons show where the regions meet across the gutter.
Read the pane labels before interpreting the colors: a local file can be
editable, while a historical snapshot is read-only. Change navigation moves
between the interesting regions without requiring you to scan every line.

### Keep more versions in view

A comparison can contain more than two panels. Visible panels controls how
many fit in the window, while the active adjacent pair determines the current
diff. Choose a fixed density or Fit; a narrower window may show fewer panels.
The numbered headers keep the sequence legible. Use this when two endpoints
hide an intermediate version that matters to the explanation.

### Start with the directory

When you know the area but not the file, compare directories first. The
inventory puts additions, deletions, and changed files together. Open a file to
inspect its contents, then return to the directory. This keeps the question
“which file matters?” separate from the closer reading of its lines.

### Find without abandoning the comparison

Search helps when you know a name or phrase but not its location. Choose the
scope before interpreting the results: an active pane, visible panes, and the
whole comparison answer different questions. A result takes you back to the
matching evidence. Replacement is a separate operation and depends on whether
the target is writable.

## Ask how it got here

### Begin with repository history

Directory history combines the file inventory with the commit axis. Files and
Commits are two ways to choose your next question. Revision labels identify the
snapshots being compared; commit-list selections are a draft until you apply
them. You can stay at repository level until a particular file deserves a
closer look.

### Follow a file through real revisions

File history brings that same timeline to one path. The panels show exact
historical contents, making a changed line something you can place in time.
History and Compare share the window controls. Use the file navigation to
visit files changed by the selected comparison, and the change controls to
move within the open file.

### Review the shape of a branch

A branch review starts with an overview of the committed range. Its suggested
reading order helps you choose an entry point; the complete file list remains
available. The range labels matter: this is a comparison of committed evidence,
not an implicit inclusion of every local edit. Start broad, then drill into the
files that explain the change.

## Turn exploration into an explanation

### Read the tour as a document

A tour adds a written argument to the evidence. The outline groups chapters,
scenes, and steps; the continuous narrative establishes the question before
pointing at source. Scrolling the narrative advances the reading position.
Scrolling the code lets you inspect the evidence without advancing the story.
The Listen controls provide another way to follow the same explanation.

### Keep the explanation beside its evidence

A step brings a precise passage into focus. Its body should explain why those
lines matter, rather than repeat their syntax. As you read farther into a
scene, the scene heading can stay at the top; expand it to recover the overview.
The narrative and evidence remain independently navigable.

### Separate explanation stages from commits

Deconstructed tours group changes into conceptual stages. These are explicitly
labeled explanation stages, so they should not be read as a claim about the
actual commit sequence. Historical tours and real revision stacks answer the
chronological question. Choose the mode that matches the explanation you want
to give, and keep its provenance visible.

### Explore, then return to the story

A tour is a route through the material, not a fence around it. Files opens the
broader inventory; Commits exposes the available revisions. History and Compare
let you investigate a question that the author did not anticipate. Return to
tour restores the authored passage after that detour.

### Write the tour with explicit evidence

The missing-tour handoff supplies an editable prompt and authoring instructions.
It does not call an AI service on your behalf. The authoring workflow remains
file based: write a .bygone source, validate the anchors against the intended
Git range, then compile or present it. Keeping the evidence explicit makes the
tour inspectable and repeatable.

## Take the work with you

### Share a particular place or a portable view

The small link beside a document heading identifies a particular place in the
tour. Local desktop links still depend on the referenced repository and tour
being available. An HTML export is the portable reading option: minimal exports
keep the tour evidence, while full exports also include bounded history.
Choose based on how much independent exploration the recipient needs.

### Stay near the editor in VS Code

The VS Code companion handles contextual file comparison and file history near
the editor. Larger repository, directory, multi-panel, and authored-tour work
can open in Desktop. This is a division of workflows across hosts, with the
same visual diff language carrying between them.

### Choose the launch that matches the question

The CLI provides direct entry points: two paths for a comparison, --history for
a file or directory, --git-diff for revisions, review for a branch, and present
--tour for an authored document. The tour subcommands provide schema,
validation, compilation, and export. Start with the smallest question you can
name, then use the shared window to expand the investigation.
