import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
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
// A signed-in sandbox whose user owns exactly one workspace, so no -w is needed.
async function owner() {
  const box = sandbox(server.url)
  const { session } = await loginAs(box, server, `proj${++n}@example.com`)
  const ws = await session.call("POST", "/api/workspaces", { name: "Acme", slug: `acme-${n}` })
  const workspace = ws.body.workspace as { id: string; slug: string }
  const addProject = async (name: string, key?: string) =>
    (await session.call("POST", `/api/workspaces/${workspace.id}/projects`, { name, key })).body
      .project as { id: string; key: string; name: string }
  return { box, session, workspace, addProject }
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"))

describe("project create", () => {
  test("derives the key from the name and returns the project with its link", async () => {
    const { box, workspace } = await owner()
    const r = await box.run([
      "project",
      "create",
      "Website Redesign",
      "--description",
      "New marketing site",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    const project = r.json()
    expect(project).toMatchObject({
      key: "WR",
      name: "Website Redesign",
      description: "New marketing site",
      workspaceId: workspace.id,
    })
    expect(project.url).toBe(`${server.url}/w/${workspace.slug}/projects/${project.id}`)
  })

  test("--key is upper-cased; a taken key exits 6", async () => {
    const { box } = await owner()
    const r = await box.run(["p", "create", "Web", "--key", "web", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json().key).toBe("WEB")
    expect((await box.run(["p", "create", "Web again", "--key", "WEB"])).exitCode).toBe(6)
  })
})

describe("project list", () => {
  test("--json, TSV and --fields", async () => {
    const { box, addProject } = await owner()
    const api = await addProject("Api", "API")
    const web = await addProject("Web", "WEB")

    const json = await box.run(["p", "list", "--json"])
    expect(json.exitCode).toBe(0)
    expect(json.json().map((p: { key: string }) => p.key)).toEqual(["API", "WEB"])
    expect(json.json()[0]).toMatchObject({ id: api.id, name: "Api", description: null })

    const tsv = await box.run(["p", "list"])
    expect(tsv.stdout).toBe("API\tApi\t\nWEB\tWeb\t\n")

    const fields = await box.run(["p", "list", "--fields", "key,id"])
    expect(fields.stdout).toBe(`API\t${api.id}\nWEB\t${web.id}\n`)

    const quiet = await box.run(["p", "list", "-q"])
    expect(quiet.stdout).toBe("API\nWEB\n")
  })
})

describe("project view", () => {
  test("shows the description, task counts per status and custom fields", async () => {
    const { box, session, addProject } = await owner()
    const project = await addProject("Website", "WEB")
    await session.call("PATCH", `/api/projects/${project.id}`, { description: "The site" })
    for (const status of ["todo", "todo", "review"]) {
      await session.call("POST", `/api/projects/${project.id}/tasks`, { title: "T", status })
    }
    await session.call("POST", `/api/projects/${project.id}/custom-fields`, {
      name: "Stage",
      type: "select",
      options: ["Alpha", "Beta"],
    })

    const r = await box.run(["p", "view", "web", "--json"])
    expect(r.exitCode).toBe(0)
    const view = r.json()
    expect(view).toMatchObject({ id: project.id, key: "WEB", description: "The site" })
    expect(view.taskCounts).toEqual({ backlog: 0, todo: 2, in_progress: 0, review: 1, complete: 0 })
    expect(view.customFields).toEqual([
      expect.objectContaining({ name: "Stage", type: "select", options: ["Alpha", "Beta"] }),
    ])

    const text = await box.run(["p", "view", "WEB"])
    expect(text.exitCode).toBe(0)
    expect(text.stdout).toContain("Website")
    expect(text.stdout).toContain("The site")
    expect(text.stdout).toMatch(/Todo\s+2/)
    expect(text.stdout).toContain("Stage")
  })

  test("without KEY uses -p, and fails naming -p when there is none", async () => {
    const { box, addProject } = await owner()
    const project = await addProject("Mobile", "MOB")
    expect((await box.run(["p", "view", "-p", "mob", "--json"])).json().id).toBe(project.id)
    const r = await box.run(["p", "view"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("-p")
  })

  test("an unknown key exits 5", async () => {
    const { box } = await owner()
    const r = await box.run(["p", "view", "NOPE"])
    expect(r.exitCode).toBe(5)
    expect(r.stderr).toContain("NOPE")
  })
})

describe("project edit", () => {
  test("--name and --description, then --no-description clears it", async () => {
    const { box, addProject } = await owner()
    await addProject("Old", "OLD")
    const r = await box.run([
      "p",
      "edit",
      "OLD",
      "--name",
      "New",
      "--description",
      "Fresh",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ key: "OLD", name: "New", description: "Fresh" })

    const cleared = await box.run(["p", "edit", "OLD", "--no-description", "--json"])
    expect(cleared.json().description).toBeNull()
  })

  test("nothing to change is a usage error", async () => {
    const { box, addProject } = await owner()
    await addProject("Same", "SAME")
    const r = await box.run(["p", "edit", "SAME"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--name")
  })
})

describe("project delete", () => {
  test("needs --yes when it cannot prompt", async () => {
    const { box, addProject } = await owner()
    await addProject("Keep", "KEEP")
    const r = await box.run(["p", "delete", "KEEP"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--yes")
    expect((await box.run(["p", "view", "KEEP"])).exitCode).toBe(0)
  })

  test("with --yes the project is gone", async () => {
    const { box, addProject } = await owner()
    await addProject("Doomed", "DOOM")
    const r = await box.run(["p", "delete", "DOOM", "--yes"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect((await box.run(["p", "view", "DOOM"])).exitCode).toBe(5)
  })

  test("--dry-run prints the request and keeps the project", async () => {
    const { box, addProject } = await owner()
    const project = await addProject("Dry", "DRY")
    const r = await box.run(["p", "delete", "DRY", "--yes", "--dry-run"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({ method: "DELETE", path: `/api/projects/${project.id}`, body: null })
    expect((await box.run(["p", "view", "DRY"])).exitCode).toBe(0)
  })
})

describe("project use", () => {
  test("sets the default project, or .intesa.json with --local", async () => {
    const { box, addProject } = await owner()
    await addProject("Website", "WEB")
    const project = await addProject("Api", "API")

    expect((await box.run(["p", "use", "web"])).exitCode).toBe(0)
    expect(readJson(join(box.configDir, "config.json")).project).toBe("WEB")

    const cwd = join(box.root, "work")
    expect((await box.run(["p", "use", "API", "--local"])).exitCode).toBe(0)
    expect(readJson(join(cwd, ".intesa.json"))).toEqual({ project: "API" })
    expect((await box.run(["p", "view", "--json"])).json().id).toBe(project.id)
  })

  test("an unknown key exits 5 and writes nothing", async () => {
    const { box } = await owner()
    expect((await box.run(["p", "use", "ZZZ", "--local"])).exitCode).toBe(5)
    expect(existsSync(join(box.root, "work", ".intesa.json"))).toBe(false)
  })
})
