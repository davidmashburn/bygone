# Generated from cli/commandSpec.js. Do not edit by hand.
function __bygone_git_refs
    git for-each-ref --format='%(refname:short)' refs/heads refs/remotes refs/tags 2>/dev/null
    printf "%s\n" HEAD INDEX WORKTREE
end

complete -c bygone -n '__fish_use_subcommand' -a review -d 'Review a committed branch against its merge base'
complete -c bygone -n '__fish_use_subcommand' -a completion -d 'Print shell completion source'
complete -c bygone -n '__fish_use_subcommand' -a present -d 'Open a browser tour of a committed branch range'
complete -c bygone -n '__fish_use_subcommand' -l diff -r -d 'Compare files, or open a blank editable diff'
complete -c bygone -n '__fish_use_subcommand' -l history -r -d 'Open Git history for a file or directory'
complete -c bygone -n '__fish_use_subcommand' -l git-diff -d 'Compare two or more Git sources'
complete -c bygone -n '__fish_use_subcommand' -l branch-diff -d 'Legacy alias for branch review'
complete -c bygone -n '__fish_use_subcommand' -l test -d 'Open the built-in test comparison'
complete -c bygone -n '__fish_use_subcommand' -s h -l help -d 'Show command help'
complete -c bygone -n '__fish_use_subcommand' -s v -l version -d 'Show the installed version'
complete -c bygone -n '__fish_seen_subcommand_from completion' -a 'zsh bash fish' -d 'Shell'
complete -c bygone -n 'string match -q "*--history*" -- (commandline -opc)' -l include-staged -l staged -d 'Include staged state in Git history'
complete -c bygone -n '__fish_seen_subcommand_from review' -l base -s m -l main -r -a '(__bygone_git_refs)' -d 'Set the branch-review base ref'
complete -c bygone -n '__fish_seen_subcommand_from review' -a '(__bygone_git_refs)' -d 'Git ref'
complete -c bygone -n '__fish_seen_subcommand_from present' -l base -s m -l main -r -a '(__bygone_git_refs)' -d 'Set the branch-review base ref'
complete -c bygone -n '__fish_seen_subcommand_from present' -l tour -r -d 'Use an authored change-tour YAML file'
complete -c bygone -n '__fish_seen_subcommand_from present' -a '(__bygone_git_refs)' -d 'Git ref'
complete -c bygone -n 'string match -q "*--branch-diff*" -- (commandline -opc)' -s b -l branch -r -a '(__bygone_git_refs)' -d 'Set the branch-review head ref'
complete -c bygone -n 'string match -q "*--branch-diff*" -- (commandline -opc)' -l base -s m -l main -r -a '(__bygone_git_refs)' -d 'Set the branch-review base ref'
complete -c bygone -n 'string match -q "*--git-diff*" -- (commandline -opc)' -a '(__bygone_git_refs)' -d 'Git source'
