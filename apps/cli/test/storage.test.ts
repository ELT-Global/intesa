import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readHosts } from "../src/config/config"
import { configDir } from "../src/config/paths"
import { forgetToken, readToken, saveToken } from "../src/config/secrets"

const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "intesa-store-"))
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe("configDir", () => {
  test("INTESA_CONFIG_DIR wins everywhere", () => {
    expect(configDir({ INTESA_CONFIG_DIR: "/x/y", APPDATA: "C:\\A" }, "win32", "C:\\H")).toBe(
      "/x/y",
    )
  })

  test("Windows uses %APPDATA%", () => {
    expect(configDir({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32", "C:\\Users\\a")).toBe(
      "C:\\Users\\a\\AppData\\Roaming\\intesa",
    )
  })

  test("elsewhere XDG_CONFIG_HOME, then ~/.config", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/home/a/.xdg" }, "linux", "/home/a")).toBe(
      "/home/a/.xdg/intesa",
    )
    expect(configDir({}, "darwin", "/Users/a")).toBe("/Users/a/.config/intesa")
  })
})

describe("secrets", () => {
  const host = "https://pm.example.com"
  const meta = {
    user: "a@example.com",
    tokenId: "tok_1",
    kind: "cli" as const,
    scope: "write" as const,
  }
  const fileEnv = { INTESA_SECRETS: "file" }

  test("file storage keeps the token in hosts.json, readable only by the owner", async () => {
    const dir = tempDir()
    const storage = await saveToken(dir, host, "intesa_cli_abc", meta, { env: fileEnv })
    expect(storage).toBe("file")
    expect(await readToken(dir, host, fileEnv)).toEqual({
      token: "intesa_cli_abc",
      storage: "file",
    })
    expect(readHosts(dir)[host]).toMatchObject({ ...meta, storage: "file" })
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "hosts.json")).mode & 0o777).toBe(0o600)
    }
  })

  test("--insecure-storage forces the file even when the keychain is allowed", async () => {
    const dir = tempDir()
    expect(await saveToken(dir, host, "intesa_cli_x", meta, { env: {}, insecure: true })).toBe(
      "file",
    )
  })

  test("INTESA_TOKEN overrides whatever is stored", async () => {
    const dir = tempDir()
    await saveToken(dir, host, "intesa_cli_stored", meta, { env: fileEnv })
    const env = { ...fileEnv, INTESA_TOKEN: "intesa_pat_env" }
    expect(await readToken(dir, host, env)).toEqual({ token: "intesa_pat_env", storage: "env" })
  })

  test("forgetting removes the host entry and its token", async () => {
    const dir = tempDir()
    await saveToken(dir, host, "intesa_cli_abc", meta, { env: fileEnv })
    await forgetToken(dir, host, fileEnv)
    expect(await readToken(dir, host, fileEnv)).toBeUndefined()
    expect(readFileSync(join(dir, "hosts.json"), "utf8")).not.toContain("intesa_cli_abc")
  })

  test("nothing stored, nothing read", async () => {
    expect(await readToken(tempDir(), host, fileEnv)).toBeUndefined()
  })
})
