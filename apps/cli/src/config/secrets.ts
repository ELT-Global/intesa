import { join } from "node:path"
import type { Env } from "../output/mode"
import { type HostEntry, readHosts, writeHosts } from "./config"

export type Storage = "keychain" | "file" | "env"
type TokenMeta = Pick<HostEntry, "user" | "tokenId" | "kind" | "scope">

const SERVICE = "intesa-cli"

// INTESA_SECRETS=file never touches the OS keychain (tests, and machines where it misbehaves).
const keychainAllowed = (env: Env) => env.INTESA_SECRETS !== "file"

export async function readToken(
  dir: string,
  host: string,
  env: Env,
): Promise<{ token: string; storage: Storage } | undefined> {
  if (env.INTESA_TOKEN) return { token: env.INTESA_TOKEN, storage: "env" }
  const entry = readHosts(dir)[host]
  if (!entry) return undefined
  if (entry.storage === "file")
    return entry.token ? { token: entry.token, storage: "file" } : undefined
  if (!keychainAllowed(env)) return undefined
  const token = await Bun.secrets.get({ service: SERVICE, name: host }).catch(() => null)
  return token ? { token, storage: "keychain" } : undefined
}

// Prefers the OS keychain. Falls back to hosts.json (0600) when the keychain is missing or
// refused, e.g. headless Linux without a Secret Service, and says so on stderr. Asking for the
// file with `insecure` is warned about too, but INTESA_SECRETS=file is a deliberate setting
// of the environment (CI, tests) and is not.
export async function saveToken(
  dir: string,
  host: string,
  token: string,
  meta: TokenMeta,
  opts: { env: Env; insecure?: boolean; warn?: (message: string) => void },
): Promise<Exclude<Storage, "env">> {
  let storage: "keychain" | "file" = "file"
  if (!opts.insecure && keychainAllowed(opts.env)) {
    try {
      await Bun.secrets.set({ service: SERVICE, name: host, value: token })
      storage = "keychain"
    } catch (err) {
      opts.warn?.(`could not use the system keychain (${String(err)}); storing the token in a file`)
    }
  }
  if (opts.insecure && keychainAllowed(opts.env)) {
    const mode = process.platform === "win32" ? "" : " (mode 0600)"
    opts.warn?.(`the token is stored in plain text in ${join(dir, "hosts.json")}${mode}`)
  }
  const hosts = readHosts(dir)
  const { token: _old, ...previous } = hosts[host] ?? {}
  hosts[host] = { ...previous, ...meta, storage, ...(storage === "file" ? { token } : {}) }
  writeHosts(dir, hosts)
  return storage
}

export async function forgetToken(dir: string, host: string, env: Env) {
  const hosts = readHosts(dir)
  if (hosts[host]?.storage === "keychain" && keychainAllowed(env)) {
    await Bun.secrets.delete({ service: SERVICE, name: host }).catch(() => false)
  }
  delete hosts[host]
  writeHosts(dir, hosts)
}
