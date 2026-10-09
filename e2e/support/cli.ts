import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const MAIN = fileURLToPath(new URL("../../apps/cli/src/main.ts", import.meta.url))

// Variables from the developer's shell or CI that would change what the CLI does.
const LEAKY = /^(INTESA_|NO_COLOR$|FORCE_COLOR$|CLICOLOR|CI$|VISUAL$|EDITOR$|PAGER$|BROWSER$)/

export type CliResult = { stdout: string; stderr: string; exitCode: number }

export type RunningCli = {
  exited: Promise<number>
  stdout: () => string
  stderr: () => string
  /** Resolves with the first match in stderr so far, waiting up to `timeoutMs` for more. */
  waitForStderr: (pattern: RegExp, timeoutMs?: number) => Promise<RegExpExecArray>
  kill: () => void
}

/**
 * A fresh config directory and the means to run the real CLI against `host`. The CLI runs
 * under Bun (found on PATH, or named by BUN), since Playwright itself runs under Node.
 */
export function cliSandbox(host: string) {
  const configDir = mkdtempSync(join(tmpdir(), "intesa-e2e-cli-"))
  const running = new Set<ChildProcess>()

  const spawnCli = (args: string[], env: Record<string, string> = {}) => {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !LEAKY.test(k)) clean[k] = v
    }
    const child = spawn(process.env.BUN ?? "bun", [MAIN, ...args], {
      cwd: configDir,
      env: {
        ...clean,
        INTESA_HOST: host,
        INTESA_CONFIG_DIR: configDir,
        INTESA_SECRETS: "file",
        INTESA_PROMPT_DISABLED: "1",
        MSYS_NO_PATHCONV: "1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    running.add(child)
    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    const exited = new Promise<number>((resolve, reject) => {
      child.once("error", reject)
      // "close" fires after the output streams have ended, so nothing is cut off.
      child.once("close", (code) => {
        running.delete(child)
        resolve(code ?? -1)
      })
    })
    return { child, exited, stdout: () => stdout, stderr: () => stderr }
  }

  return {
    configDir,

    /** Runs a command to completion. */
    async run(args: string[], env?: Record<string, string>): Promise<CliResult> {
      const p = spawnCli(args, env)
      const exitCode = await withTimeout(p.exited, 30_000, `intesa ${args.join(" ")}`)
      return { stdout: p.stdout(), stderr: p.stderr(), exitCode }
    },

    /** Starts a command and leaves it running, for flows that act while it waits. */
    start(args: string[], env?: Record<string, string>): RunningCli {
      const p = spawnCli(args, env)
      return {
        exited: p.exited,
        stdout: p.stdout,
        stderr: p.stderr,
        kill: () => p.child.kill(),
        async waitForStderr(pattern, timeoutMs = 20_000) {
          const deadline = Date.now() + timeoutMs
          while (Date.now() < deadline) {
            const match = pattern.exec(p.stderr())
            if (match) return match
            await new Promise((r) => setTimeout(r, 50))
          }
          throw new Error(`stderr never matched ${pattern}:\n${p.stderr()}`)
        },
      }
    },

    /** Stops anything still running and removes the config directory. */
    dispose() {
      for (const child of running) child.kill()
      running.clear()
      rmSync(configDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
