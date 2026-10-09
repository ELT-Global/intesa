import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { addMember } from "../../api/test/helpers"
import { readHosts } from "../src/config/config"
import { loginAs, removeSandboxes, sandbox, startServer, type TestServer } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

let n = 0
// A signed-in sandbox whose user owns workspaces with these names (slugs are made unique).
async function userWith(names: string[]) {
  const email = `ws${++n}@example.com`
  const box = sandbox(server.url)
  const { session } = await loginAs(box, server, email)
  const workspaces: { id: string; name: string; slug: string }[] = []
  for (const name of names) {
    const r = await session.call("POST", "/api/workspaces", { name, slug: `${name}-${n}` })
    workspaces.push(r.body.workspace)
  }
  return { box, session, email, workspaces }
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"))

describe("workspace list", () => {
  test("--json lists the user's workspaces with their web links", async () => {
    const { box, workspaces } = await userWith(["alpha", "beta"])
    const r = await box.run(["workspace", "list", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual(
      workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        role: "owner",
        url: `${server.url}/w/${w.slug}/home`,
      })),
    )
  })

  test("piped output is TSV of slug, name and role; `ws` is an alias", async () => {
    const { box, workspaces } = await userWith(["gamma"])
    const r = await box.run(["ws", "ls"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe(`${workspaces[0]?.slug}\tgamma\towner\n`)
  })

  test("--fields and -q", async () => {
    const { box, workspaces } = await userWith(["delta"])
    const fields = await box.run(["ws", "list", "--json", "--fields", "slug"])
    expect(fields.json()).toEqual([{ slug: workspaces[0]?.slug }])
    const quiet = await box.run(["ws", "list", "-q"])
    expect(quiet.stdout).toBe(`${workspaces[0]?.id}\n`)
  })
})

describe("workspace view", () => {
  test("by slug, or the only workspace when none is given", async () => {
    const { box, workspaces } = await userWith(["only"])
    const ws = workspaces[0]
    const bySlug = await box.run(["ws", "view", ws?.slug ?? "", "--json"])
    expect(bySlug.exitCode).toBe(0)
    expect(bySlug.json()).toMatchObject({ id: ws?.id, slug: ws?.slug, name: "only" })
    const implicit = await box.run(["ws", "view", "--json"])
    expect(implicit.json().id).toBe(ws?.id)
  })

  test("with several workspaces and none chosen, exits 2 naming -w", async () => {
    const { box } = await userWith(["one", "two"])
    const r = await box.run(["ws", "view"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("-w")
    expect(r.stderr).toContain("one-")
  })

  test("an unknown slug exits 5", async () => {
    const { box } = await userWith(["known"])
    const r = await box.run(["ws", "view", "unknown-slug"])
    expect(r.exitCode).toBe(5)
    expect(r.stderr).toContain("unknown-slug")
  })

  test("caches the slug's id for the host", async () => {
    const { box, workspaces } = await userWith(["cached", "other"])
    const ws = workspaces[0]
    await box.run(["ws", "view", "-w", ws?.slug ?? "", "--json"])
    expect(readHosts(box.configDir)[server.url]?.workspace).toEqual({
      slug: ws?.slug ?? "",
      id: ws?.id ?? "",
    })
  })
})

describe("workspace create and rename", () => {
  test("create derives the slug from the name", async () => {
    const { box } = await userWith([])
    const r = await box.run(["ws", "create", "Brand New Team", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({
      name: "Brand New Team",
      slug: "brand-new-team",
      role: "owner",
    })
    expect(r.json().url).toBe(`${server.url}/w/brand-new-team/home`)
  })

  test("create --slug; a taken slug exits 6", async () => {
    const { box } = await userWith([])
    const r = await box.run(["ws", "create", "Custom", "--slug", `custom-${n}`, "--json"])
    expect(r.json().slug).toBe(`custom-${n}`)
    const again = await box.run(["ws", "create", "Again", "--slug", `custom-${n}`])
    expect(again.exitCode).toBe(6)
  })

  test("rename changes the current workspace's name", async () => {
    const { box, workspaces } = await userWith(["before"])
    const r = await box.run(["ws", "rename", "After", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ id: workspaces[0]?.id, name: "After" })
  })

  test("rename by a non-owner exits 7", async () => {
    const owner = await userWith(["owned"])
    const ws = owner.workspaces[0]
    const member = await userWith([])
    await addMember(server, ws?.id ?? "", member.email)
    const r = await member.box.run(["ws", "rename", "Mine now", "-w", ws?.slug ?? ""])
    expect(r.exitCode).toBe(7)
  })
})

describe("workspace use", () => {
  test("sets the default workspace in the user config", async () => {
    const { box, workspaces } = await userWith(["first", "second"])
    const second = workspaces[1]
    const r = await box.run(["ws", "use", second?.slug ?? ""])
    expect(r.exitCode).toBe(0)
    expect(readJson(join(box.configDir, "config.json")).workspace).toBe(second?.slug)
    expect((await box.run(["ws", "view", "--json"])).json().id).toBe(second?.id)
  })

  test("an unknown slug exits 5 and changes nothing", async () => {
    const { box } = await userWith(["real"])
    const r = await box.run(["ws", "use", "not-a-workspace"])
    expect(r.exitCode).toBe(5)
    expect(existsSync(join(box.configDir, "config.json"))).toBe(false)
  })

  test("--local writes .intesa.json in the current directory, keeping other keys", async () => {
    const { box, workspaces } = await userWith(["left", "right"])
    const right = workspaces[1]
    const repo = join(box.root, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    writeFileSync(join(repo, ".intesa.json"), JSON.stringify({ project: "WEB" }))

    const r = await box.run(["ws", "use", right?.slug ?? "", "--local"], { cwd: repo })
    expect(r.exitCode).toBe(0)
    expect(readJson(join(repo, ".intesa.json"))).toEqual({ project: "WEB", workspace: right?.slug })
    expect(existsSync(join(box.configDir, "config.json"))).toBe(false)

    const nested = await box.run(["ws", "view", "--json"], { cwd: join(repo, "src") })
    expect(nested.json().id).toBe(right?.id)
  })
})

describe("workspace commands need a signed-in user", () => {
  test("logged out, exits 4", async () => {
    const r = await sandbox(server.url).run(["ws", "list"])
    expect(r.exitCode).toBe(4)
  })
})
