import { describe, expect, test } from "bun:test"
import { strToU8, zipSync } from "fflate"
import { MAX_ARTIFACT_BYTES, MAX_IMAGE_BYTES } from "../src/artifacts/formats"
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

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
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
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
    expect((await owner.request(wrong, { method: "DELETE" })).status).toBe(404)
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

  test("stores screenshots as images, served cacheably, and checks their signatures", async () => {
    const { owner, url, upload } = await setup()
    const res = await upload("Screenshot 2026-11-11.png", PNG, "image/png")
    expect(res.status).toBe(201)
    const { artifact } = await uploaded(res)
    expect(artifact).toMatchObject({ mimeType: "image/png", size: PNG.length })
    const download = await owner.request(`${url}/${artifact.id}`)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(PNG)
    expect(download.headers.get("content-type")).toBe("image/png")
    expect(download.headers.get("cache-control")).toBe("private, max-age=86400")
    expect(download.headers.get("x-content-type-options")).toBe("nosniff")
    const jpeg = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.alloc(16)])
    const gif = Buffer.from("GIF89a  ", "latin1")
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])
    for (const [name, bytes] of [
      ["photo.JPG", jpeg],
      ["photo.jpeg", jpeg],
      ["loop.gif", gif],
      ["shot.webp", webp],
    ] as const) {
      expect((await upload(name, bytes)).status, name).toBe(201)
    }
    for (const [name, bytes, type] of [
      ["fake.png", Buffer.from("<script>alert(1)</script>"), "image/png"],
      ["jpeg.png", jpeg, ""],
      ["png.webp", PNG, ""],
      ["vector.svg", Buffer.from("<svg/>"), "image/svg+xml"],
    ] as const) {
      expect((await upload(name, bytes, type)).status, name).toBe(400)
    }
    expect((await upload("shot.png", PNG, "", `${url}/${artifact.id}`, "PUT")).status).toBe(400)
  })

  test("images may be up to 10 MB while documents stay at 5 MB", async () => {
    const { upload } = await setup()
    const pad = (bytes: number) => Buffer.concat([PNG, Buffer.alloc(bytes - PNG.length)])
    expect((await upload("big.png", pad(MAX_IMAGE_BYTES))).status).toBe(201)
    const tooBig = await upload("huge.png", pad(MAX_IMAGE_BYTES + 1))
    expect(tooBig.status).toBe(400)
    expect(((await tooBig.json()) as { message: string }).message).toContain("10 MB")
    expect((await upload("six.md", "x".repeat(MAX_ARTIFACT_BYTES + 1))).status).toBe(400)
  }, 30_000)

  test("deletes an artifact of any format; deleting it again is a 404", async () => {
    const { owner, url, upload } = await setup()
    const { artifact: pdf } = await uploaded(await upload("brief.pdf", "%PDF-1.7\n"))
    const { artifact: png } = await uploaded(await upload("shot.png", PNG))
    expect((await owner.request(`${url}/${pdf.id}`, { method: "DELETE" })).status).toBe(204)
    expect((await owner.request(`${url}/${png.id}`, { method: "DELETE" })).status).toBe(204)
    expect((await owner.call("GET", url)).body.artifacts).toEqual([])
    expect((await owner.request(`${url}/${pdf.id}`)).status).toBe(404)
    expect((await owner.request(`${url}/${pdf.id}`, { method: "DELETE" })).status).toBe(404)
  })
})

describe("images in a task's description", () => {
  test("an image removed from the description is deleted; kept images and documents stay", async () => {
    const { t, owner, taskId, url, upload } = await setup()
    const ids = async () =>
      ((await owner.call("GET", url)).body.artifacts as { id: string }[]).map((a) => a.id).sort()
    const { artifact: kept } = await uploaded(await upload("kept.png", PNG))
    const { artifact: dropped } = await uploaded(await upload("dropped.png", PNG))
    const { artifact: doc } = await uploaded(await upload("spec.pdf", "%PDF-1.7\n"))
    const { artifact: loose } = await uploaded(await upload("loose.png", PNG))
    const image = (id: string, host = "") => `![shot](${host}${url}/${id})`
    const save = (body: string | null) => owner.call("PATCH", `/api/tasks/${taskId}`, { body })

    // Absolute links (as the CLI or an agent may write them) count as well as relative ones.
    await save(
      [
        image(kept.id),
        image(dropped.id, "https://intesa.example"),
        `[spec](${url}/${doc.id})`,
      ].join("\n"),
    )
    expect(await ids()).toEqual([kept.id, dropped.id, doc.id, loose.id].sort())

    expect((await save(`Moved.\n${image(kept.id)}`)).status).toBe(200)
    // The document leaves the description but stays an artifact; the unlinked image is not
    // the description's to delete.
    expect(await ids()).toEqual([kept.id, doc.id, loose.id].sort())

    await save(null)
    expect(await ids()).toEqual([doc.id, loose.id].sort())
    expect(await t.db.selectFrom("artifacts").select("id").execute()).toHaveLength(2)
  })

  test("an update rejected after the clean-up deletes nothing", async () => {
    const { owner, taskId, url, upload } = await setup()
    const { artifact } = await uploaded(await upload("shot.png", PNG))
    await owner.call("PATCH", `/api/tasks/${taskId}`, { body: `![shot](${url}/${artifact.id})` })
    const res = await owner.call("PATCH", `/api/tasks/${taskId}`, {
      body: "",
      customFields: { "no-such-field": "x" },
    })
    expect(res.status).toBe(400)
    expect((await owner.call("GET", url)).body.artifacts).toHaveLength(1)
  })
})
