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
        'bygone --branch-diff [-b BRANCH] [-m MAIN]',
        'bygone completion <zsh|bash|fish>',
        'bygone --test'
    ],
    entries: [
        {
            id: 'review',
            kind: 'command',
            tokens: ['review'],
            description: 'Review a committed branch against its merge base',
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
