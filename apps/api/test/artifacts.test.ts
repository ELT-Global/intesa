import { describe, expect, test } from "bun:test"
import { strToU8, zipSync } from "fflate"
import { MAX_ARTIFACT_BYTES } from "../src/artifacts/formats"
import { createTestApp, setupProject, signIn } from "./helpers"

async function setup() {
  const t = await createTestApp()
  const { owner, project } = await setupProject(t, "artifacts@example.com")
  const task = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
    title: "With artifacts",
  })
  const url = `/api/tasks/${task.body.task.id}/artifacts`
  const upload = (
    name: string,
    content: string | Buffer,
    type = "",
    path = url,
    method = "POST",
  ) => {
    const body = new FormData()
    body.set("file", new File([content], name, { type }))
    return owner.request(path, { method, body })
  }
  return { t, owner, project, taskId: task.body.task.id as string, url, upload }
}

const uploaded = async (res: Response) =>
  (await res.json()) as {
    artifact: { id: string; name: string; mimeType: string; size: number; content?: unknown }
  }

describe("artifacts", () => {
  test("stores exact binary bytes, lists metadata without content, and cascades with task deletion", async () => {
    const { t, owner, url, upload, taskId } = await setup()
    const bytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0, 1, 128, 255])])
    const res = await upload("Résumé.PDF", bytes, "application/pdf")
    expect(res.status).toBe(201)
    const { artifact } = await uploaded(res)
    expect(artifact).toMatchObject({
      name: "Résumé.PDF",
      mimeType: "application/pdf",
      size: bytes.length,
    })
    const list = await owner.call("GET", url)
    expect(list.body.artifacts).toEqual([artifact])
    expect(artifact.content).toBeUndefined()
    const download = await owner.request(`${url}/${artifact.id}`)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
    expect(download.headers.get("content-type")).toBe("application/pdf")
    expect(download.headers.get("content-security-policy")).toBeNull()
    expect(download.headers.get("content-disposition")).toContain(encodeURIComponent("Résumé.PDF"))
    await owner.call("DELETE", `/api/tasks/${taskId}`)
    expect(await t.db.selectFrom("artifacts").selectAll().execute()).toEqual([])
    expect((await owner.request(`${url}/${artifact.id}`)).status).toBe(404)
  })

  test("replaces Markdown in place, including empty content; other formats cannot be replaced", async () => {
    const { owner, url, upload } = await setup()
    const { artifact } = await uploaded(await upload("notes.md", "# Before", "text/plain"))
    const path = `${url}/${artifact.id}`
    expect((await upload("notes.md", "# After 😃", "text/markdown", path, "PUT")).status).toBe(200)
    expect(await (await owner.request(path)).text()).toBe("# After 😃")
    expect((await owner.call("GET", url)).body.artifacts).toHaveLength(1)
    expect((await upload("notes.md", "", "text/markdown", path, "PUT")).status).toBe(200)
    expect(await (await owner.request(path)).text()).toBe("")
    expect((await upload("notes.html", "Oops", "text/html", path, "PUT")).status).toBe(400)
    const html = await uploaded(await upload("page.html", "<h1>Hello</h1>"))
    expect(
      (await upload("page.html", "changed", "text/html", `${url}/${html.artifact.id}`, "PUT"))
        .status,
    ).toBe(400)
    const response = await owner.request(`${url}/${html.artifact.id}`)
    expect(response.headers.get("content-security-policy")).toContain("sandbox;")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  test("checks membership and task ownership for every endpoint", async () => {
    const { t, owner, project, url, upload } = await setup()
    const { artifact } = await uploaded(await upload("secret.md", "Private"))
    const outsider = await signIn(t.app, "outsider@example.com")
    for (const method of ["GET", "POST", "PUT"]) {
      const path = method === "GET" ? url : `${url}/${artifact.id}`
      expect((await outsider.request(path, { method })).status).toBe(404)
    }
    expect((await outsider.request(`${url}/${artifact.id}`)).status).toBe(404)
    expect((await outsider.request(url, { method: "POST" })).status).toBe(404)
    expect((await t.app.request(url)).status).toBe(401)
    const other = await owner.call("POST", `/api/projects/${project.id}/tasks`, { title: "Other" })
    const wrong = `/api/tasks/${other.body.task.id}/artifacts/${artifact.id}`
    expect((await owner.request(wrong)).status).toBe(404)
    expect((await upload("secret.md", "Overwrite", "text/markdown", wrong, "PUT")).status).toBe(404)
    expect(await (await owner.request(`${url}/${artifact.id}`)).text()).toBe("Private")
  })

  test("rejects unsupported extensions, disguised binaries and malformed uploads", async () => {
    const { owner, url, upload } = await setup()
    for (const [name, content, type] of [
      ["script.exe", "MZ", "application/octet-stream"],
      ["file.constructor", "invalid", ""],
      ["md", "missing extension", ""],
      ["fake.pdf", "plain text", "application/pdf"],
      ["fake.doc", "plain text", "application/msword"],
      ["fake.docx", "plain text", ""],
      ["fake.odt", "plain text", ""],
      ["fake.md", "\u0000binary", ""],
    ] as const) {
      expect((await upload(name, content, type)).status, name).toBe(400)
    }
    expect((await owner.request(url, { method: "POST", body: "invalid" })).status).toBe(400)
    const empty = new FormData()
    expect((await owner.request(url, { method: "POST", body: empty })).status).toBe(400)
    const multiple = new FormData()
    multiple.append("file", new File(["one"], "one.md"))
    multiple.append("file", new File(["two"], "two.md"))
    expect((await owner.request(url, { method: "POST", body: multiple })).status).toBe(400)
    expect((await owner.call("GET", url)).body.artifacts).toEqual([])
  })

  test("validates Office containers rather than accepting renamed ZIP archives", async () => {
    const { upload } = await setup()
    for (const name of ["brief.docx", "brief.odt"]) {
      const bytes = Buffer.from(
        await Bun.file(
          new URL(`../../../e2e/fixtures/artifacts/${name}`, import.meta.url),
        ).arrayBuffer(),
      )
      expect((await upload(name, bytes)).status).toBe(201)
    }
    const unrelated = Buffer.from(zipSync({ "readme.txt": strToU8("Not a document") }))
    expect((await upload("renamed.docx", unrelated)).status).toBe(400)
    expect((await upload("renamed.odt", unrelated)).status).toBe(400)
    const spreadsheet = Buffer.concat([
      Buffer.from("d0cf11e0a1b11ae1", "hex"),
      Buffer.from("Workbook", "utf16le"),
    ])
    expect((await upload("spreadsheet.doc", spreadsheet)).status).toBe(400)
    const wrongOdf = Buffer.from(
      zipSync({
        mimetype: strToU8("application/vnd.oasis.opendocument.spreadsheet"),
        "content.xml": strToU8("<document/>"),
      }),
    )
    expect((await upload("wrong.odt", wrongOdf)).status).toBe(400)
    expect((await upload("valid.ods", wrongOdf)).status).toBe(201)
  })

  test("allows exactly 5 MB and rejects larger uploads and replacements without changing saved data", async () => {
    const { owner, url, upload } = await setup()
    const max = "x".repeat(MAX_ARTIFACT_BYTES)
    const accepted = await upload("limit.md", max)
    expect(accepted.status).toBe(201)
    const { artifact } = await uploaded(accepted)
    expect((await upload("large.md", `${max}x`)).status).toBe(400)
    expect((await upload("limit.md", `${max}x`, "", `${url}/${artifact.id}`, "PUT")).status).toBe(
      400,
    )
    // Exercise the request limit too, including chunked requests without Content-Length.
    expect((await upload("large.md", `${max}${"x".repeat(128 * 1024)}`)).status).toBe(400)
    expect((await owner.call("GET", url)).body.artifacts).toHaveLength(1)
    expect((await owner.request(`${url}/${artifact.id}`)).headers.get("content-length")).toBe(
      String(MAX_ARTIFACT_BYTES),
    )
  }, 30_000)
})
