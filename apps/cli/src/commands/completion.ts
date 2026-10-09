import { completionScript, SHELLS, type Shell } from "../registry/completion-scripts"
import { defineCommand } from "../registry/define"
import { allCommands } from "."

export default defineCommand({
  name: "completion",
  summary: "Generate a shell completion script",
  description: [
    "Print a script that completes intesa commands, flags and values in your shell.",
    "",
    "bash:        add `source <(intesa completion bash)` to ~/.bashrc",
    "zsh:         add `source <(intesa completion zsh)` to ~/.zshrc, after compinit",
    "fish:        run `intesa completion fish > ~/.config/fish/completions/intesa.fish`",
    "powershell:  add `intesa completion powershell | Out-String | Invoke-Expression` to $PROFILE",
    "",
    "Command and flag names are in the script. Values such as ids are looked up as you press",
    "tab, so they need a working login; if the lookup fails, nothing is suggested.",
  ].join("\n"),
  args: [{ name: "shell", required: true, enum: SHELLS }],
  examples: ["intesa completion bash", "intesa completion powershell"],
  async run(ctx, { shell }) {
    ctx.stdout(completionScript(shell as Shell, await allCommands()))
  },
})
