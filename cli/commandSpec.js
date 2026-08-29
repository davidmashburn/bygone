const CLI_SPEC = Object.freeze({
    name: 'bygone',
    summary: 'Visual diff and file history',
    usages: [
        'bygone',
        'bygone <file-or-directory>',
        'bygone <left> <right>',
        'bygone --diff <left> <right>',
        'bygone --diff',
        'bygone --diff <file1> <file2> <file3> [...]',
        'bygone --history <path>',
        'bygone --git-diff <ref1> <ref2> [<ref3>...]',
        'bygone review [<head>] [--base <base>]',
        'bygone review <pull-request-url>',
        'bygone review --pr <number|url|owner/repo#number>',
        'bygone -C <directory> <command-or-path> [...]',
        'bygone present [<head>] [--base <base>] [--tour <file.bygone>]',
        'bygone present <pull-request-url>',
        'bygone tour validate <file.bygone> [--json]',
        'bygone tour compile <file.bygone> [--output <tour.json>]',
        'bygone tour context [<head>] [--base <base>] [--pr <number|url>] [--output <context.json>]',
        'bygone tour coverage <file.bygone> [--json] [--minimum-coverage <0-100>]',
        'bygone tour schema',
        'bygone --branch-diff [-b BRANCH] [-m MAIN]',
        'bygone completion <zsh|bash|fish>',
        'bygone --test'
    ],
    entries: [
        {
            id: 'review',
            kind: 'command',
            tokens: ['review'],
            description: 'Review a committed branch or pull request against its merge base',
            argument: 'git-ref'
        },
        {
            id: 'completion',
            kind: 'command',
            tokens: ['completion'],
            description: 'Print shell completion source',
            argument: 'shell'
        },
        {
            id: 'present',
            kind: 'command',
            tokens: ['present'],
            description: 'Open an app-hosted tour of a committed branch range',
            argument: 'git-ref'
        },
        {
            id: 'tourCommand',
            kind: 'command',
            tokens: ['tour'],
            description: 'Validate, compile, or inspect authored change tours',
            argument: 'tour-action'
        },
        {
            id: 'diff',
            kind: 'mode',
            tokens: ['--diff'],
            description: 'Compare files, or open a blank editable diff',
            argument: 'files'
        },
        {
            id: 'history',
            kind: 'mode',
            tokens: ['--history'],
            description: 'Open Git history for a file or directory',
            argument: 'path'
        },
        {
            id: 'gitDiff',
            kind: 'mode',
            tokens: ['--git-diff'],
            description: 'Compare two or more Git sources',
            argument: 'git-refs'
        },
        {
            id: 'branchDiff',
            kind: 'mode',
            tokens: ['--branch-diff'],
            description: 'Legacy alias for branch review',
            argument: 'git-ref'
        },
        {
            id: 'test',
            kind: 'mode',
            tokens: ['--test'],
            description: 'Open the built-in test comparison',
            argument: 'none'
        },
        {
            id: 'includeStaged',
            kind: 'option',
            tokens: ['--include-staged', '--staged'],
            description: 'Include staged state in Git history',
            argument: 'none'
        },
        {
            id: 'base',
            kind: 'option',
            tokens: ['--base', '-m', '--main'],
            description: 'Set the branch-review base ref',
            argument: 'git-ref'
        },
        {
            id: 'pullRequest',
            kind: 'option',
            tokens: ['--pr', '--pull-request'],
            description: 'Review a GitHub pull request by number, URL, or owner/repo#number',
            argument: 'pull-request'
        },
        {
            id: 'tour',
            kind: 'option',
            tokens: ['--tour'],
            description: 'Use an authored .bygone presentation',
            argument: 'path'
        },
        {
            id: 'directory',
            kind: 'global',
            tokens: ['-C'],
            description: 'Run as if Bygone started in this directory',
            argument: 'path'
        },
        {
            id: 'branch',
            kind: 'option',
            tokens: ['-b', '--branch'],
            description: 'Set the branch-review head ref',
            argument: 'git-ref'
        },
        {
            id: 'help',
            kind: 'global',
            tokens: ['-h', '--help'],
            description: 'Show command help',
            argument: 'none'
        },
        {
            id: 'version',
            kind: 'global',
            tokens: ['-v', '--version'],
            description: 'Show the installed version',
            argument: 'none'
        }
    ],
    notes: [
        'No args opens Git directory history inside a Git repo, or a blank editable diff outside one.',
        '`--diff` with no paths opens a blank editable diff.',
        'One positional path opens file history or Git directory history.',
        '`--history` accepts either files or directories.',
        'Two positional paths auto-select file diff or directory compare.',
        'Three or more positional paths auto-select multi-panel file diff or multi-directory compare.',
        '`--git-diff` accepts branches, tags, SHAs, HEAD~1, stash@{0}, INDEX, and WORKTREE.',
        '`review` compares merge-base(BASE,HEAD) with HEAD and detects the default base when omitted.',
        '`review`, `present`, and `tour context` accept a pull request as a URL, `owner/repo#number`, or `--pr <number>` inside a clone.',
        'Pull request review needs the GitHub CLI (`gh`), fetches `refs/pull/<number>/head`, and works without a local clone.',
        'The pull request title, author, and description travel into change tours and `tour context` as stated intent.',
        '`present` turns the same range into an app-hosted, ordered change tour.',
        '`-C <directory>` resolves relative paths and Git refs from that directory without changing the shell working directory.',
        '`tour validate` resolves every authored anchor; add `--json` for agent-readable output.',
        '`tour compile` writes a portable manifest to stdout or `--output`; `tour schema` prints its source schema.',
        '`tour context` emits compact, structured Git evidence for an LLM without invoking a model.',
        '`tour coverage` reports referenced changed hunks and author-declared explanation depth.',
        '`--branch-diff` is retained as an alias for `review`.',
        '`completion` prints a completion script for Zsh, Bash, or Fish.',
        'In the standalone app, drop 1 file for history, 2 files/directories for compare, or 3+ matching paths for multi-panel compare.'
    ]
});

function getCliEntry(id) {
    return CLI_SPEC.entries.find((entry) => entry.id === id);
}

function tokensFor(id) {
    return getCliEntry(id)?.tokens ?? [];
}

function tokenMatches(id, token) {
    return tokensFor(id).includes(token);
}

function renderCliHelp(version) {
    const usage = CLI_SPEC.usages.map((line) => `  ${line}`).join('\n');
    const entries = CLI_SPEC.entries.map((entry) => (
        `  ${entry.tokens.join(', ')}\n      ${entry.description}`
    )).join('\n');
    const notes = CLI_SPEC.notes.map((line) => `  - ${line}`).join('\n');
    return `Bygone ${version}\n\nUsage:\n${usage}\n\nCommands and options:\n${entries}\n\nNotes:\n${notes}\n`;
}

module.exports = {
    CLI_SPEC,
    getCliEntry,
    renderCliHelp,
    tokenMatches,
    tokensFor
};
