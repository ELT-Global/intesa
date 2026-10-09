import { homedir } from "node:os"
import { posix, win32 } from "node:path"
import type { Env } from "../output/mode"

export function configDir(env: Env, platform: string = process.platform, home = homedir()) {
  if (env.INTESA_CONFIG_DIR) return env.INTESA_CONFIG_DIR
  if (platform === "win32") {
    return win32.join(env.APPDATA || win32.join(home, "AppData", "Roaming"), "intesa")
  }
  return posix.join(env.XDG_CONFIG_HOME || posix.join(home, ".config"), "intesa")
}
