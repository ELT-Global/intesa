import { describe, expect, test } from "bun:test"
import { MAX_AVATAR_BYTES } from "../src/auth/avatars"
import { findOrCreateUser } from "../src/auth/users"
import { type Client, createTestApp, setupProject, signIn, userId } from "./helpers"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)
const GIF = Buffer.from("R0lGODlhAQABAAAAACw=", "base64")

const upload = (client: Client, content: string | Buffer, name = "me.png", type = "image/png") => {
  const body = new FormData()
  body.set("file", new File([content], name, { type }))
  return client.request("/api/me/avatar", { method: "PUT", body })
}

const userOf = async (res: Response) =>
  ((await res.json()) as { user: { avatarUrl: string | null; avatarUploaded: boolean } }).user

describe("avatars", () => {
  test("an uploaded avatar is served to other users and shown as the user's picture", async () => {
    const t = await createTestApp()
    const { owner, workspaceId } = await setupProject(t, "pic@example.com")
    const other = await signIn(t.app, "other@example.com")

    const res = await upload(owner, PNG)
    expect(res.status).toBe(200)
    const user = await userOf(res)
    expect(user.avatarUploaded).toBe(true)
    expect(user.avatarUrl).toMatch(/^\/api\/users\/[\w-]+\/avatar\?v=\w+$/)
    expect((await owner.call("GET", "/api/me")).body.user.avatarUrl).toBe(user.avatarUrl)
    const members = await owner.call("GET", `/api/workspaces/${workspaceId}/members`)
    expect(members.body.members[0].avatarUrl).toBe(user.avatarUrl)

    // Someone outside the workspace still sees it, e.g. in a task's history.
    const image = await other.request(user.avatarUrl ?? "")
    expect(image.status).toBe(200)
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG)
    expect(image.headers.get("content-type")).toBe("image/png")
    expect(image.headers.get("cache-control")).toContain("immutable")
    expect(image.headers.get("x-content-type-options")).toBe("nosniff")
    expect((await t.app.request(user.avatarUrl ?? "")).status).toBe(401)

    // A new upload is a new URL; the old one is no longer cached for long.
    const next = await userOf(await upload(owner, GIF, "anim.gif", "image/gif"))
    expect(next.avatarUrl).not.toBe(user.avatarUrl)
    const stale = await other.request(user.avatarUrl ?? "")
    expect(stale.headers.get("content-type")).toBe("image/gif")
    expect(stale.headers.get("cache-control")).toBe("private, no-cache")
  })

  test("only raster images by their bytes, up to 2 MB", async () => {
    const t = await createTestApp()
    const owner = await signIn(t.app, "strict@example.com")
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    expect((await upload(owner, svg, "x.svg", "image/svg+xml")).status).toBe(400)
    expect((await upload(owner, "not a png", "fake.png")).status).toBe(400)
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES)])
    const tooBig = await upload(owner, big)
    expect(tooBig.status).toBe(400)
    expect(((await tooBig.json()) as { message: string }).message).toBe(
      "Avatars must be 2 MB or smaller.",
    )
    // A PNG named .jpg is stored as what it is.
    const user = await userOf(await upload(owner, PNG, "photo.jpg", "image/jpeg"))
    const image = await owner.request(user.avatarUrl ?? "")
    expect(image.headers.get("content-type")).toBe("image/png")
    expect((await owner.call("GET", "/api/users/nobody/avatar")).status).toBe(404)
  })

  test("removing falls back to the Google picture, which a later sign-in does not put back over an upload", async () => {
    const t = await createTestApp()
    const google = "https://lh3.googleusercontent.com/a/one"
    await findOrCreateUser(t.db, { email: "g@example.com", avatarUrl: google, googleSub: "sub-g" })
    const owner = await signIn(t.app, "g@example.com")
    const id = await userId(t, "g@example.com")

    const uploaded = await userOf(await upload(owner, PNG))
    const again = await findOrCreateUser(t.db, {
      email: "g@example.com",
      avatarUrl: "https://lh3.googleusercontent.com/a/two",
      googleSub: "sub-g",
    })
    expect(again.avatarUrl).toBe(uploaded.avatarUrl)

    const removed = await owner.call("DELETE", "/api/me/avatar")
    expect(removed.status).toBe(200)
    expect(removed.body.user).toMatchObject({
      avatarUrl: "https://lh3.googleusercontent.com/a/two",
      avatarUploaded: false,
    })
    expect((await owner.request(`/api/users/${id}/avatar`)).status).toBe(404)
    expect(await t.db.selectFrom("userAvatars").selectAll().execute()).toEqual([])
  })

  test("read-only tokens cannot change the avatar", async () => {
    const t = await createTestApp()
    const owner = await signIn(t.app, "token@example.com")
    const created = await owner.call("POST", "/api/me/tokens", { name: "ro", scope: "read" })
    const body = new FormData()
    body.set("file", new File([PNG], "me.png"))
    const res = await t.app.request("/api/me/avatar", {
      method: "PUT",
      body,
      headers: { authorization: `Bearer ${created.body.token}` },
    })
    expect(res.status).toBe(403)
  })
})
