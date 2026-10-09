import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { TAG_COLORS } from "@intesa/api/schemas"
import { loginAs, removeSandboxes, sandbox, startServer, type TestServer } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

type Tag = { id: string; name: string; color: string }

let n = 0
// A signed-in sandbox whose user owns exactly one workspace, so no -w is needed.
async function owner() {
  const id = ++n
  const box = sandbox(server.url)
  const { session } = await loginAs(box, server, `tag${id}@example.com`)
  const ws = await session.call("POST", "/api/workspaces", { name: "Acme", slug: `acme-${id}` })
  const workspace = ws.body.workspace as { id: string; slug: string }
  const tags = async (): Promise<Tag[]> => (await box.run(["tag", "list", "--json"])).json()
  const add = async (name: string, color = "blue") =>
    (await session.call("POST", `/api/workspaces/${workspace.id}/tags`, { name, color })).body
      .tag as Tag
  return { box, session, workspace, tags, add }
}

describe("tag create", () => {
  test("creates a tag with the colour asked for and returns it", async () => {
    const { box, tags } = await owner()
    const r = await box.run(["tag", "create", "Urgent", "--tag-color", "violet", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({ id: expect.any(String), name: "Urgent", color: "violet" })
    expect(await tags()).toEqual([r.json()])
  })

  test("without --tag-color the server picks one from the palette", async () => {
    const { box } = await owner()
    const r = await box.run(["tag", "create", "Plain", "--json"])
    expect(r.exitCode).toBe(0)
    expect(TAG_COLORS).toContain(r.json().color)
    const dry = await box.run(["tag", "create", "Plain 2", "--dry-run"])
    expect(dry.json().body).toEqual({ name: "Plain 2" })
  })

  test("a name taken in another case exits 6", async () => {
    const { box, tags } = await owner()
    expect((await box.run(["tag", "create", "Bug"])).exitCode).toBe(0)
    const r = await box.run(["tag", "create", "bUG"])
    expect(r.exitCode).toBe(6)
    expect(r.stderr).toContain("already exists")
    expect(await tags()).toHaveLength(1)
  })

  test("a colour outside the palette is a usage error and creates nothing", async () => {
    const { box, tags } = await owner()
    const r = await box.run(["tag", "create", "Odd", "--tag-color", "chartreuse"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--tag-color")
    expect(r.stderr).toContain(TAG_COLORS.join("|"))
    expect(await tags()).toEqual([])
  })

  test("the name is required, and a name the server rejects exits 8", async () => {
    const { box } = await owner()
    expect((await box.run(["tag", "create"])).exitCode).toBe(2)
    expect((await box.run(["tag", "create", "x".repeat(41)])).exitCode).toBe(8)
  })

  test("a read-only token cannot create tags (exit 7)", async () => {
    const id = ++n
    const box = sandbox(server.url)
    const { session } = await loginAs(box, server, `tag-ro${id}@example.com`, { scope: "read" })
    await session.call("POST", "/api/workspaces", { name: "Acme", slug: `acme-ro${id}` })
    expect((await box.run(["tag", "create", "Nope"])).exitCode).toBe(7)
  })
})

describe("tag list", () => {
  test("--json is ordered by name; piped output is id, name and colour", async () => {
    const { box, add } = await owner()
    const beta = await add("beta", "gray")
    const alpha = await add("alpha", "aqua")
    const json = await box.run(["tag", "list", "--json"])
    expect(json.json()).toEqual([alpha, beta])
    expect((await box.run(["tag", "ls"])).stdout).toBe(
      `${alpha.id}\talpha\taqua\n${beta.id}\tbeta\tgray\n`,
    )
  })

  test("--fields and -q", async () => {
    const { box, add } = await owner()
    const tag = await add("solo", "orange")
    const fields = await box.run(["tag", "list", "--json", "--fields", "name,color"])
    expect(fields.json()).toEqual([{ name: "solo", color: "orange" }])
    expect((await box.run(["tag", "list", "-q"])).stdout).toBe(`${tag.id}\n`)
    expect((await box.run(["tag", "list", "--fields", "nope"])).exitCode).toBe(2)
  })

  test("tags are per workspace: -w selects, and another workspace's tag is not found", async () => {
    const { box, add, workspace } = await owner()
    const tag = await add("mine")
    await box.run(["ws", "create", "Other", "--slug", `other-${n}`])
    const r = await box.run(["tag", "list", "-w", `other-${n}`, "--json"])
    expect(r.json()).toEqual([])
    const missing = await box.run(["tag", "delete", tag.id, "--yes", "-w", `other-${n}`])
    expect(missing.exitCode).toBe(5)
    expect((await box.run(["tag", "list", "-w", workspace.slug, "--json"])).json()).toEqual([tag])
  })
})

describe("tag edit", () => {
  test("renames and recolours, finding the tag by name in any case or by id", async () => {
    const { box, add } = await owner()
    const tag = await add("Draft", "blue")
    const renamed = await box.run(["tag", "edit", "draft", "--name", "Final", "--json"])
    expect(renamed.exitCode).toBe(0)
    expect(renamed.json()).toEqual({ id: tag.id, name: "Final", color: "blue" })

    const recoloured = await box.run(["tag", "edit", tag.id, "--tag-color", "magenta", "--json"])
    expect(recoloured.json()).toEqual({ id: tag.id, name: "Final", color: "magenta" })
  })

  test("renaming to another tag's name exits 6", async () => {
    const { box, add, tags } = await owner()
    await add("One")
    await add("Two")
    const r = await box.run(["tag", "edit", "Two", "--name", "ONE"])
    expect(r.exitCode).toBe(6)
    expect((await tags()).map((t) => t.name)).toEqual(["One", "Two"])
  })

  test("only the case of its own name can change", async () => {
    const { box, add } = await owner()
    await add("tidy")
    const r = await box.run(["tag", "edit", "tidy", "--name", "Tidy", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json().name).toBe("Tidy")
  })

  test("nothing to change and a bad colour are usage errors", async () => {
    const { box, add } = await owner()
    await add("Same")
    const none = await box.run(["tag", "edit", "Same"])
    expect(none.exitCode).toBe(2)
    expect(none.stderr).toContain("--name")
    const bad = await box.run(["tag", "edit", "Same", "--tag-color", "red"])
    expect(bad.exitCode).toBe(2)
    expect(bad.stderr).toContain("--tag-color")
  })

  test("an unknown tag exits 5", async () => {
    const { box } = await owner()
    const r = await box.run(["tag", "edit", "ghost", "--name", "x"])
    expect(r.exitCode).toBe(5)
    expect(r.stderr).toContain("ghost")
  })
})

describe("tag delete", () => {
  test("refuses without --yes when it cannot prompt, and keeps the tag", async () => {
    const { box, add, tags } = await owner()
    await add("Keep")
    const r = await box.run(["tag", "delete", "Keep"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--yes")
    expect(await tags()).toHaveLength(1)
  })

  test("--yes deletes it, also from the tasks that had it", async () => {
    const { box, session, workspace, add, tags } = await owner()
    const tag = await add("Doomed")
    const project = (
      await session.call("POST", `/api/workspaces/${workspace.id}/projects`, {
        name: "Web",
        key: "WEB",
      })
    ).body.project
    const task = (
      await session.call("POST", `/api/projects/${project.id}/tasks`, {
        title: "Tagged",
        tagIds: [tag.id],
      })
    ).body.task
    expect(task.tags).toHaveLength(1)

    const r = await box.run(["tag", "delete", "doomed", "--yes"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect(await tags()).toEqual([])
    expect((await session.call("GET", `/api/tasks/${task.id}`)).body.task.tags).toEqual([])
  })

  test("--json reports what was deleted", async () => {
    const { box, add } = await owner()
    const tag = await add("Gone")
    const r = await box.run(["tag", "delete", "Gone", "--yes", "--json"])
    expect(r.json()).toEqual({ id: tag.id, name: "Gone", deleted: true })
  })

  test("--dry-run needs no confirmation and keeps the tag", async () => {
    const { box, add, tags } = await owner()
    const tag = await add("Dry")
    const r = await box.run(["tag", "delete", "Dry", "--dry-run"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({ method: "DELETE", path: `/api/tags/${tag.id}`, body: null })
    expect(await tags()).toHaveLength(1)
  })
})
