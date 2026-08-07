# Generated from cli/commandSpec.js. Do not edit by hand.
function __bygone_git_refs
    git for-each-ref --format='%(refname:short)' refs/heads refs/remotes refs/tags 2>/dev/null
    printf "%s\n" HEAD INDEX WORKTREE
end

complete -c bygone -n '__fish_use_subcommand' -a review -d 'Review a committed branch against its merge base'
complete -c bygone -n '__fish_use_subcommand' -a completion -d 'Print shell completion source'
complete -c bygone -n '__fish_use_subcommand' -a present -d 'Open an app-hosted tour of a committed branch range'
complete -c bygone -n '__fish_use_subcommand' -a tour -d 'Validate, compile, or inspect authored change tours'
complete -c bygone -n '__fish_use_subcommand' -l diff -r -d 'Compare files, or open a blank editable diff'
complete -c bygone -n '__fish_use_subcommand' -l history -r -d 'Open Git history for a file or directory'
complete -c bygone -n '__fish_use_subcommand' -l git-diff -d 'Compare two or more Git sources'
complete -c bygone -n '__fish_use_subcommand' -l branch-diff -d 'Legacy alias for branch review'
complete -c bygone -n '__fish_use_subcommand' -l test -d 'Open the built-in test comparison'
complete -c bygone -n '__fish_use_subcommand' -s h -l help -d 'Show command help'
complete -c bygone -n '__fish_use_subcommand' -s v -l version -d 'Show the installed version'
complete -c bygone -n '__fish_seen_subcommand_from completion' -a 'zsh bash fish' -d 'Shell'
complete -c bygone -n '__fish_seen_subcommand_from tour' -a 'context validate compile schema' -d 'Tour action'
complete -c bygone -n 'string match -q "*tour context*" -- (commandline -opc)' -l base -r -a '(__bygone_git_refs)' -d 'Set the change-context base ref'
complete -c bygone -n 'string match -q "*tour context*" -- (commandline -opc)' -l output -s o -r -d 'Write the change context'
complete -c bygone -n 'string match -q "*tour context*" -- (commandline -opc)' -l max-patch-bytes -r -d 'Maximum included patch size per file'
complete -c bygone -n 'string match -q "*tour context*" -- (commandline -opc)' -l max-total-patch-bytes -r -d 'Maximum included patch size for the dossier'
complete -c bygone -n 'string match -q "*tour validate*" -- (commandline -opc)' -l json -d 'Print machine-readable validation output'
complete -c bygone -n 'string match -q "*tour compile*" -- (commandline -opc)' -l output -s o -r -d 'Write the compiled manifest'
complete -c bygone -n 'string match -q "*--history*" -- (commandline -opc)' -l include-staged -l staged -d 'Include staged state in Git history'
complete -c bygone -n '__fish_seen_subcommand_from review' -l base -s m -l main -r -a '(__bygone_git_refs)' -d 'Set the branch-review base ref'
complete -c bygone -n '__fish_seen_subcommand_from review' -a '(__bygone_git_refs)' -d 'Git ref'
complete -c bygone -n '__fish_seen_subcommand_from present' -l base -s m -l main -r -a '(__bygone_git_refs)' -d 'Set the branch-review base ref'
complete -c bygone -n '__fish_seen_subcommand_from present' -l tour -r -d 'Use an authored change-tour YAML file'
complete -c bygone -n '__fish_seen_subcommand_from present' -a '(__bygone_git_refs)' -d 'Git ref'
complete -c bygone -n 'string match -q "*--branch-diff*" -- (commandline -opc)' -s b -l branch -r -a '(__bygone_git_refs)' -d 'Set the branch-review head ref'
complete -c bygone -n 'string match -q "*--branch-diff*" -- (commandline -opc)' -l base -s m -l main -r -a '(__bygone_git_refs)' -d 'Set the branch-review base ref'
complete -c bygone -n 'string match -q "*--git-diff*" -- (commandline -opc)' -a '(__bygone_git_refs)' -d 'Git source'
