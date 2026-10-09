import { dryRunWrite } from "../client/http"
import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  type ConfigKey,
  configFile,
  configKeyHelp,
  parseConfigKey,
  parseConfigValue,
  readConfig,
  writeConfig,
} from "../config/config"
import { defineCommand, defineGroup } from "../registry/define"

const keyList = CONFIG_KEYS.map((k) => `  ${k.padEnd(10)} ${configKeyHelp(k)}`).join("\n")
const effective = (config: Record<string, unknown>, key: ConfigKey) =>
  (config[key] as string | undefined) ?? CONFIG_DEFAULTS[key] ?? null

const get = defineCommand({
  name: "get",
  summary: "Print the value of a configuration key",
  description: `Print the value of a configuration key; nothing when it is unset.\n\nKeys:\n${keyList}`,
  args: [{ name: "key", required: true }],
  output: "config",
  examples: ["intesa config get editor", "intesa config get host --json"],
  run(ctx, { key }) {
    const k = parseConfigKey(key)
    return { key: k, value: effective(ctx.config, k) }
  },
  human: (_ctx, { value }) => (value === null ? "" : `${value}\n`),
})

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "Print every configuration key and its value",
  output: "config",
  examples: ["intesa config list", "intesa config list --json"],
  run(ctx) {
    return CONFIG_KEYS.map((key) => ({ key, value: effective(ctx.config, key) }))
  },
})

const set = defineCommand({
  name: "set",
  summary: "Set a configuration key",
  description: `Set a configuration key in the user config file.\n\nKeys:\n${keyList}`,
  args: [
    { name: "key", required: true },
    { name: "value", required: true },
  ],
  output: "config",
  examples: [
    "intesa config set host https://pm.example.com",
    "intesa config set editor 'code --wait'",
    "intesa config set prompt disabled",
  ],
  run(ctx, { key, value }) {
    const k = parseConfigKey(key)
    const config = { ...readConfig(ctx.configDir), [k]: parseConfigValue(k, value) }
    if (ctx.globals.dryRun) dryRunWrite(ctx, configFile(ctx.configDir), config)
    writeConfig(ctx.configDir, config)
    ctx.done(`Set ${k} to ${config[k]}`)
    return { key: k, value: config[k] }
  },
  human: () => "",
})

export default defineGroup({
  name: "config",
  summary: "Get and set intesa configuration",
  description:
    "Display or change intesa's configuration, stored in config.json in the config directory.",
  commands: [get, list, set],
  examples: ["intesa config set workspace acme", "intesa config list"],
})
