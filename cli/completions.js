const { CLI_SPEC, getCliEntry, tokensFor } = require('./commandSpec.js');

const SUPPORTED_SHELLS = Object.freeze(['zsh', 'bash', 'fish']);

function generateCompletion(shell) {
    if (shell === 'zsh') {
        return generateZshCompletion();
    }
    if (shell === 'bash') {
        return generateBashCompletion();
    }
    if (shell === 'fish') {
        return generateFishCompletion();
    }
    throw new Error(`Unsupported shell "${shell}". Choose: ${SUPPORTED_SHELLS.join(', ')}.`);
}

function completionFileName(shell) {
    if (shell === 'zsh') {
        return '_bygone';
    }
    if (shell === 'bash') {
        return 'bygone';
    }
    if (shell === 'fish') {
        return 'bygone.fish';
    }
    throw new Error(`Unsupported shell "${shell}".`);
}

function generateZshCompletion() {
    const rootItems = completionEntries()
        .flatMap((entry) => entry.tokens.map((token) => `        '${token}:${escapeSingleQuoted(entry.description)}'`))
        .join('\n');
    const reviewOptions = entriesByIds(['base', 'help'])
        .flatMap((entry) => entry.tokens.map((token) => `        '${token}:${escapeSingleQuoted(entry.description)}'`))
        .join('\n');
    const legacyOptions = entriesByIds(['branch', 'base', 'help'])
        .flatMap((entry) => entry.tokens.map((token) => `        '${token}:${escapeSingleQuoted(entry.description)}'`))
        .join('\n');
    const historyOptions = entriesByIds(['includeStaged', 'help'])
        .flatMap((entry) => entry.tokens.map((token) => `        '${token}:${escapeSingleQuoted(entry.description)}'`))
        .join('\n');

    return `#compdef bygone
# Generated from cli/commandSpec.js. Do not edit by hand.

_bygone_git_refs() {
    local -a refs
    refs=(\${(f)"$(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes refs/tags 2>/dev/null)"})
    _describe 'git source' refs
    compadd -- HEAD INDEX WORKTREE
}

_bygone() {
    local first="\${words[2]}"
    local previous="\${words[CURRENT-1]}"
    local -a root_items review_options legacy_options history_options shells
    root_items=(
${rootItems}
    )
    review_options=(
${reviewOptions}
    )
    legacy_options=(
${legacyOptions}
    )
    history_options=(
${historyOptions}
    )
    shells=('zsh:Z shell' 'bash:Bash' 'fish:Fish shell')

    if (( CURRENT == 2 )); then
        _describe 'bygone command' root_items
        _files
        return
    fi

    case "$first" in
        completion)
            _describe 'shell' shells
            ;;
        review)
            if [[ "$previous" == ${shellAlternation(tokensFor('base'))} ]]; then
                _bygone_git_refs
            else
                _describe 'review option' review_options
                _bygone_git_refs
            fi
            ;;
        --branch-diff)
            if [[ "$previous" == ${shellAlternation([...tokensFor('branch'), ...tokensFor('base')])} ]]; then
                _bygone_git_refs
            else
                _describe 'review option' legacy_options
                _bygone_git_refs
            fi
            ;;
        --git-diff)
            _bygone_git_refs
            ;;
        --history)
            _describe 'history option' history_options
            _files
            ;;
        --diff)
            _files
            ;;
        *)
            _files
            ;;
    esac
}

compdef _bygone bygone
`;
}

function generateBashCompletion() {
    const rootTokens = completionEntries().flatMap((entry) => entry.tokens).join(' ');
    const reviewTokens = entriesByIds(['base', 'help']).flatMap((entry) => entry.tokens).join(' ');
    const legacyTokens = entriesByIds(['branch', 'base', 'help']).flatMap((entry) => entry.tokens).join(' ');
    const historyTokens = entriesByIds(['includeStaged', 'help']).flatMap((entry) => entry.tokens).join(' ');
    const baseTokens = tokensFor('base').join('|');
    const refTokens = [...tokensFor('branch'), ...tokensFor('base')].join('|');

    return `# Generated from cli/commandSpec.js. Do not edit by hand.
_bygone_git_refs() {
    git for-each-ref --format='%(refname:short)' refs/heads refs/remotes refs/tags 2>/dev/null
    printf '%s\\n' HEAD INDEX WORKTREE
}

_bygone() {
    local cur prev first refs
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    first="\${COMP_WORDS[1]}"

    if (( COMP_CWORD == 1 )); then
        COMPREPLY=( $(compgen -W '${rootTokens}' -- "$cur") $(compgen -f -- "$cur") )
        compopt -o filenames 2>/dev/null || true
        return
    fi

    case "$first" in
        completion)
            COMPREPLY=( $(compgen -W 'zsh bash fish' -- "$cur") )
            ;;
        review)
            refs="$(_bygone_git_refs)"
            if [[ "$prev" =~ ^(${baseTokens})$ ]]; then
                COMPREPLY=( $(compgen -W "$refs" -- "$cur") )
            else
                COMPREPLY=( $(compgen -W '${reviewTokens} '"$refs" -- "$cur") )
            fi
            ;;
        --branch-diff)
            refs="$(_bygone_git_refs)"
            if [[ "$prev" =~ ^(${refTokens})$ ]]; then
                COMPREPLY=( $(compgen -W "$refs" -- "$cur") )
            else
                COMPREPLY=( $(compgen -W '${legacyTokens} '"$refs" -- "$cur") )
            fi
            ;;
        --git-diff)
            COMPREPLY=( $(compgen -W "$(_bygone_git_refs)" -- "$cur") )
            ;;
        --history)
            COMPREPLY=( $(compgen -W '${historyTokens}' -- "$cur") $(compgen -f -- "$cur") )
            compopt -o filenames 2>/dev/null || true
            ;;
        *)
            COMPREPLY=( $(compgen -f -- "$cur") )
            compopt -o filenames 2>/dev/null || true
            ;;
    esac
}

complete -F _bygone bygone
`;
}

function generateFishCompletion() {
    const lines = [
        '# Generated from cli/commandSpec.js. Do not edit by hand.',
        'function __bygone_git_refs',
        "    git for-each-ref --format='%(refname:short)' refs/heads refs/remotes refs/tags 2>/dev/null",
        '    printf "%s\\n" HEAD INDEX WORKTREE',
        'end',
        ''
    ];

    for (const entry of completionEntries()) {
        const option = fishTokens(entry.tokens);
        const argument = entry.argument === 'path' || entry.argument === 'files' ? ' -r' : '';
        lines.push(`complete -c bygone -n '__fish_use_subcommand' ${option}${argument} -d '${escapeSingleQuoted(entry.description)}'`);
    }

    lines.push(
        "complete -c bygone -n '__fish_seen_subcommand_from completion' -a 'zsh bash fish' -d 'Shell'",
        `complete -c bygone -n 'string match -q "*--history*" -- (commandline -opc)' ${fishTokens(tokensFor('includeStaged'))} -d '${escapeSingleQuoted(getCliEntry('includeStaged').description)}'`,
        `complete -c bygone -n '__fish_seen_subcommand_from review' ${fishTokens(tokensFor('base'))} -r -a '(__bygone_git_refs)' -d '${escapeSingleQuoted(getCliEntry('base').description)}'`,
        "complete -c bygone -n '__fish_seen_subcommand_from review' -a '(__bygone_git_refs)' -d 'Git ref'",
        `complete -c bygone -n 'string match -q "*--branch-diff*" -- (commandline -opc)' ${fishTokens(tokensFor('branch'))} -r -a '(__bygone_git_refs)' -d '${escapeSingleQuoted(getCliEntry('branch').description)}'`,
        `complete -c bygone -n 'string match -q "*--branch-diff*" -- (commandline -opc)' ${fishTokens(tokensFor('base'))} -r -a '(__bygone_git_refs)' -d '${escapeSingleQuoted(getCliEntry('base').description)}'`,
        `complete -c bygone -n 'string match -q "*--git-diff*" -- (commandline -opc)' -a '(__bygone_git_refs)' -d 'Git source'`
    );
    return `${lines.join('\n')}\n`;
}

function completionEntries() {
    return CLI_SPEC.entries.filter((entry) => (
        entry.kind === 'command' || entry.kind === 'mode' || entry.kind === 'global'
    ));
}

function entriesByIds(ids) {
    return ids.map((id) => getCliEntry(id)).filter(Boolean);
}

function shellAlternation(tokens) {
    return `(${tokens.join('|')})`;
}

function fishTokenOption(token) {
    if (token.startsWith('--')) {
        return `-l ${token.slice(2)}`;
    }
    if (token.startsWith('-')) {
        return `-s ${token.slice(1)}`;
    }
    return `-a ${token}`;
}

function fishTokens(tokens) {
    return tokens.map(fishTokenOption).join(' ');
}

function escapeSingleQuoted(value) {
    return String(value).replace(/'/g, "'\\''");
}

module.exports = {
    SUPPORTED_SHELLS,
    completionFileName,
    generateCompletion
};
