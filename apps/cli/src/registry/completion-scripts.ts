import type { allCommands } from "../commands"
import { flagWords } from "./completion"

export const SHELLS = ["bash", "zsh", "fish", "powershell"] as const
export type Shell = (typeof SHELLS)[number]

type Commands = Awaited<ReturnType<typeof allCommands>>

// What the scripts know without asking the CLI: command names, subcommands and the first
// flags after them. Once a flag has been typed, or for argument values, a script calls
// `intesa __complete`, which understands the whole line. Names are plain words, so they
// need no shell quoting.
type Tables = {
  nouns: string[]
  // Subcommands of each noun spelling (`token`, and its aliases).
  verbs: [noun: string, verbs: string[]][]
  // Flags by the words typed so far: "" (nothing), "token", "token create".
  flags: [words: string, flags: string[]][]
}

export function tablesFor(commands: Commands): Tables {
  const tables: Tables = { nouns: [], verbs: [], flags: [["", flagWords()]] }
  const groups = new Map<string, { spellings: string[]; verbs: string[] }>()
  for (const { cmd, names } of commands) {
    const [nounNames = [], verbNames] = names
    if (!verbNames) {
      tables.nouns.push(...nounNames)
      for (const n of nounNames) tables.flags.push([n, flagWords(cmd)])
      continue
    }
    const key = nounNames[0] ?? ""
    const group = groups.get(key) ?? { spellings: nounNames, verbs: [] }
    group.verbs.push(...verbNames)
    groups.set(key, group)
    for (const n of nounNames) {
      for (const v of verbNames) tables.flags.push([`${n} ${v}`, flagWords(cmd)])
    }
  }
  for (const { spellings, verbs } of groups.values()) {
    tables.nouns.push(...spellings)
    for (const n of spellings) {
      tables.verbs.push([n, verbs])
      tables.flags.push([n, flagWords()])
    }
  }
  tables.nouns.sort()
  return tables
}

const join = (words: string[]) => words.join(" ")
const lines = (rows: string[]) => rows.join("\n")

function bash(t: Tables) {
  const flagCases = t.flags.map(([k, f]) => `        "${k}") opts="${join(f)}" ;;`)
  const verbCases = t.verbs.map(([n, v]) => `        ${n}) opts="${join(v)}" ;;`)
  return `# bash completion for intesa
# Load it with: source <(intesa completion bash)
_intesa() {
  local IFS=$' \\t\\n'
  local cur="\${COMP_WORDS[COMP_CWORD]}" w opts="" flagged=0
  local -a words=("\${COMP_WORDS[@]:1:COMP_CWORD-1}")
  for w in "\${words[@]}"; do
    [[ $w == -* ]] && flagged=1
  done
  [[ $cur == *=* ]] && flagged=1
  if ((flagged == 0)); then
    if [[ $cur == -* ]]; then
      case "\${words[*]}" in
${lines(flagCases)}
      esac
    elif ((\${#words[@]} == 0)); then
      opts="${join(t.nouns)}"
    elif ((\${#words[@]} == 1)); then
      case "\${words[0]}" in
${lines(verbCases)}
      esac
    fi
  fi
  if [[ -n $opts ]]; then
    COMPREPLY=($(compgen -W "$opts" -- "$cur"))
  else
    local IFS=$'\\n'
    COMPREPLY=($(intesa __complete --word="$cur" -- "\${words[@]}" 2>/dev/null))
  fi
}
complete -F _intesa intesa
`
}

function zsh(t: Tables) {
  const flagCases = t.flags.map(([k, f]) => `        "${k}") opts=(${join(f)}) ;;`)
  const verbCases = t.verbs.map(([n, v]) => `        ${n}) opts=(${join(v)}) ;;`)
  return `#compdef intesa
# zsh completion for intesa
# Load it with: source <(intesa completion zsh)
# or save it as _intesa in a directory on your fpath.
_intesa() {
  local cur=$words[CURRENT] w
  local -a prior opts
  local flagged=0
  prior=("\${(@)words[2,CURRENT-1]}")
  for w in "\${prior[@]}"; do
    [[ $w == -* ]] && flagged=1
  done
  [[ $cur == *=* ]] && flagged=1
  if (( flagged == 0 )); then
    if [[ $cur == -* ]]; then
      case "\${prior[*]}" in
${lines(flagCases)}
      esac
    elif (( \${#prior} == 0 )); then
      opts=(${join(t.nouns)})
    elif (( \${#prior} == 1 )); then
      case "\${prior[1]}" in
${lines(verbCases)}
      esac
    fi
  fi
  if (( \${#opts} == 0 )); then
    opts=( \${(f)"$(intesa __complete --word="$cur" -- "\${prior[@]}" 2>/dev/null)"} )
  fi
  compadd -a opts
}

if [ "$funcstack[1]" = "_intesa" ]; then
  _intesa "$@"
else
  compdef _intesa intesa
fi
`
}

function fish(t: Tables) {
  const arm = (pattern: string, words: string[]) =>
    `                case ${pattern}\n                    printf '%s\\n' ${join(words)}\n                    return`
  const flagCases = t.flags.map(([k, f]) => arm(`'${k}'`, f))
  const verbCases = t.verbs.map(([n, v]) => arm(n, v))
  return `# fish completion for intesa
# Load it with: intesa completion fish | source
function __intesa_complete
    set -l words (commandline -opc)
    set -e words[1]
    set -l cur (commandline -ct)
    set -l flagged 0
    for w in $words
        string match -q -- '-*' $w; and set flagged 1
    end
    string match -q -- '*=*' $cur; and set flagged 1
    if test $flagged -eq 0
        if string match -q -- '-*' $cur
            switch (string join ' ' -- $words | string collect)
${lines(flagCases)}
            end
        else if test (count $words) -eq 0
            printf '%s\\n' ${join(t.nouns)}
            return
        else if test (count $words) -eq 1
            switch $words[1]
${lines(verbCases)}
            end
        end
    end
    intesa __complete --word=$cur -- $words 2>/dev/null
end
complete -c intesa -f -a '(__intesa_complete)'
`
}

function powershell(t: Tables) {
  const list = (words: string[]) => `@(${words.map((w) => `'${w}'`).join(", ")})`
  const flagRows = t.flags.map(([k, f]) => `        '${k || "_"}' = ${list(f)}`)
  const verbRows = t.verbs.map(([n, v]) => `        '${n}' = ${list(v)}`)
  return `# PowerShell completion for intesa
# Load it with: intesa completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName intesa -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $nouns = ${list(t.nouns)}
    $verbs = @{
${lines(verbRows)}
    }
    $flags = @{
${lines(flagRows)}
    }
    $words = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() })
    if ($wordToComplete -ne '' -and $words.Count -gt 0) {
        $words = @($words | Select-Object -SkipLast 1)
    }
    $flagged = $wordToComplete.Contains('=') -or @($words | Where-Object { $_ -like '-*' }).Count -gt 0
    $opts = @()
    if (-not $flagged) {
        if ($wordToComplete -like '-*') {
            $key = if ($words.Count -gt 0) { $words -join ' ' } else { '_' }
            $opts = $flags[$key]
        } elseif ($words.Count -eq 0) {
            $opts = $nouns
        } elseif ($words.Count -eq 1) {
            $opts = $verbs[$words[0]]
        }
    }
    if (-not $opts) {
        $opts = @(& intesa __complete "--word=$wordToComplete" -- @words 2>$null)
    }
    $opts | Where-Object { $_.StartsWith($wordToComplete, [StringComparison]::OrdinalIgnoreCase) } |
        ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`
}

const generators = { bash, zsh, fish, powershell } satisfies Record<Shell, (t: Tables) => string>

export const completionScript = (shell: Shell, commands: Commands) =>
  generators[shell](tablesFor(commands))
