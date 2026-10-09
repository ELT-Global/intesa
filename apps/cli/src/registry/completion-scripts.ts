export const SHELLS = ["bash", "zsh", "fish", "powershell"] as const
export type Shell = (typeof SHELLS)[number]

// Each script hands the words typed so far to `intesa __complete`, which knows every command,
// flag and value, and offers what it prints. The word being typed goes as `--word=…` so that
// an empty one survives Windows PowerShell, which drops empty arguments to programs.
const SCRIPTS: Record<Shell, string> = {
  bash: `# bash completion for intesa
# Load it with: source <(intesa completion bash)
_intesa() {
  local IFS=$'\\n'
  COMPREPLY=($(intesa __complete --word="\${COMP_WORDS[COMP_CWORD]}" -- "\${COMP_WORDS[@]:1:COMP_CWORD-1}" 2>/dev/null))
}
complete -F _intesa intesa
`,
  zsh: `#compdef intesa
# zsh completion for intesa
# Load it with: source <(intesa completion zsh)
# or save it as _intesa in a directory on your fpath.
_intesa() {
  local -a opts
  opts=(\${(f)"$(intesa __complete --word="$words[CURRENT]" -- "\${(@)words[2,CURRENT-1]}" 2>/dev/null)"})
  compadd -a opts
}

if [ "$funcstack[1]" = "_intesa" ]; then
  _intesa "$@"
else
  compdef _intesa intesa
fi
`,
  fish: `# fish completion for intesa
# Load it with: intesa completion fish | source
function __intesa_complete
    set -l words (commandline -opc)
    set -e words[1]
    set -l cur (commandline -ct)
    intesa __complete --word="$cur" -- $words 2>/dev/null
end
complete -c intesa -f -a '(__intesa_complete)'
`,
  powershell: `# PowerShell completion for intesa
# Load it with: intesa completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName intesa -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $words = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() })
    if ($wordToComplete -ne '' -and $words.Count -gt 0) {
        $words = @($words | Select-Object -SkipLast 1)
    }
    & intesa __complete "--word=$wordToComplete" -- @words 2>$null |
        ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`,
}

export const completionScript = (shell: Shell) => SCRIPTS[shell]
