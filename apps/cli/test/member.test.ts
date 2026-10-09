import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { addMember, signIn } from "../../api/test/helpers"
import {
  removeSandboxes,
  type Sandbox,
  signedIn,
  startServer,
  type TestServer,
  world,
} from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

type Member = { id: string; userId: string; name: string; email: string; role: string }

let n = 0
const setName = (email: string, name: string) =>
  server.db.updateTable("users").set({ name }).where("email", "=", email).execute()

// "Alan" owns a fresh workspace, which is his only one, so no -w is needed.
async function team() {
  ++n
  const { box, email: ownerEmail, workspace } = await world(server)

  // A signed-in sandbox for someone who already has an account and joins the workspace.
  const join = async (name: string, role: "owner" | "member" = "member") => {
    const person = await signedIn(server)
    await setName(person.email, name)
    await addMember(server, workspace.id, person.email, role)
    return { box: person.box, email: person.email }
  }
  const members = async (as: Sandbox = box): Promise<Member[]> =>
    (await as.run(["member", "list", "--json"])).json()
  return { box, ownerEmail, workspace, join, members }
}

describe("member list", () => {
  test("--json lists members with name, email and role, ordered by name", async () => {
    const { box, join, ownerEmail } = await team()
    const ben = await join("Ben Member")
    const r = await box.run(["member", "list", "--json"])
    expect(r.exitCode).toBe(0)
    const members = r.json()
    expect(members.map((m: Member) => [m.name, m.email, m.role])).toEqual([
      ["Alan Owner", ownerEmail, "owner"],
      ["Ben Member", ben.email, "member"],
    ])
    expect(members[0]).toEqual({
      id: expect.any(String),
      userId: expect.any(String),
      name: "Alan Owner",
      email: ownerEmail,
      avatarUrl: null,
      role: "owner",
      createdAt: expect.any(String),
    })
  })

  test("piped output is name, email and role; -q prints the member ids", async () => {
    const { box, join, ownerEmail } = await team()
    const ben = await join("Ben Member")
    const tsv = await box.run(["member", "list"])
    expect(tsv.stdout).toBe(`Alan Owner\t${ownerEmail}\towner\nBen Member\t${ben.email}\tmember\n`)
    const ids = (await box.run(["member", "list", "--json"])).json().map((m: Member) => m.id)
    expect((await box.run(["member", "list", "-q"])).stdout).toBe(`${ids.join("\n")}\n`)
  })

  test("--fields narrows JSON and rejects unknown fields before any request", async () => {
    const { box, ownerEmail } = await team()
    const r = await box.run(["member", "list", "--json", "--fields", "email,role"])
    expect(r.json()).toEqual([{ email: ownerEmail, role: "owner" }])
    const bad = await box.run(["member", "list", "--fields", "nope"])
    expect(bad.exitCode).toBe(2)
    expect(bad.stderr).toContain("nope")
  })

  test("-w picks the workspace when there are several", async () => {
    const { box, workspace } = await team()
    await box.run(["ws", "create", "Second", "--slug", `second-${n}`])
    const ambiguous = await box.run(["member", "list"])
    expect(ambiguous.exitCode).toBe(2)
    expect(ambiguous.stderr).toContain("-w")
    const r = await box.run(["member", "list", "-w", workspace.slug, "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toHaveLength(1)
  })
})

describe("member add", () => {
  test("adds an unknown email as a member, normalised to lower case", async () => {
    const { box, members } = await team()
    const email = `newcomer${n}@example.com`
    const r = await box.run(["member", "add", email.toUpperCase(), "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ email, role: "member" })
    expect((await members()).map((m) => m.email)).toContain(email)
  })

  test("--role owner", async () => {
    const { box } = await team()
    const r = await box.run(["member", "add", `boss${n}@example.com`, "--role", "owner", "--json"])
    expect(r.json().role).toBe("owner")
  })

  test("an existing member exits 6", async () => {
    const { box, join } = await team()
    const ben = await join("Ben Member")
    expect((await box.run(["member", "add", ben.email])).exitCode).toBe(6)
  })

  test("an invalid --role is a usage error and adds nobody", async () => {
    const { box, members } = await team()
    const r = await box.run(["member", "add", `x${n}@example.com`, "--role", "admin"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--role")
    expect(await members()).toHaveLength(1)
  })

  test("an email the server rejects exits 8", async () => {
    const { box } = await team()
    expect((await box.run(["member", "add", "not-an-email"])).exitCode).toBe(8)
  })

  test("the email argument is required", async () => {
    const { box } = await team()
    expect((await box.run(["member", "add"])).exitCode).toBe(2)
  })

  test("a member who is not an owner cannot add people (exit 7)", async () => {
    const { join, members, box } = await team()
    const ben = await join("Ben Member")
    const r = await ben.box.run(["member", "add", `friend${n}@example.com`])
    expect(r.exitCode).toBe(7)
    expect(await members(box)).toHaveLength(2)
  })
})

describe("member role", () => {
  test("changes a role, naming the member by email, by name (any case) or by id", async () => {
    const { box, join, members } = await team()
    const ben = await join("Ben Member")
    const byEmail = await box.run(["member", "role", ben.email, "owner", "--json"])
    expect(byEmail.exitCode).toBe(0)
    expect(byEmail.json()).toMatchObject({ email: ben.email, role: "owner" })

    expect((await box.run(["member", "role", "ben member", "member"])).exitCode).toBe(0)
    expect((await members()).find((m) => m.email === ben.email)?.role).toBe("member")

    const id = (await members()).find((m) => m.email === ben.email)?.id ?? ""
    expect((await box.run(["member", "role", id, "owner"])).exitCode).toBe(0)
    expect((await members()).find((m) => m.email === ben.email)?.role).toBe("owner")
  })

  test("@me is the signed-in user, and the last owner cannot step down (exit 6)", async () => {
    const { box, join, members, ownerEmail } = await team()
    const r = await box.run(["member", "role", "@me", "member"])
    expect(r.exitCode).toBe(6)
    expect(r.stderr).toContain("owner")
    expect((await members()).find((m) => m.email === ownerEmail)?.role).toBe("owner")

    // With a second owner she can.
    await join("Ben Member", "owner")
    expect((await box.run(["member", "role", "@me", "member"])).exitCode).toBe(0)
    expect((await members()).find((m) => m.email === ownerEmail)?.role).toBe("member")
  })

  test("the role must be owner or member", async () => {
    const { box, join } = await team()
    const ben = await join("Ben Member")
    const r = await box.run(["member", "role", ben.email, "admin"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("owner|member")
  })

  test("an unknown member exits 5; two people with the same name exit 2 and are listed", async () => {
    const { box, join, workspace } = await team()
    expect((await box.run(["member", "role", "nobody@example.com", "owner"])).exitCode).toBe(5)

    const a = await join("Sam Same")
    const second = `sam2-${n}@example.com`
    await signIn(server.app, second)
    await setName(second, "Sam Same")
    await addMember(server, workspace.id, second)
    const r = await box.run(["member", "role", "sam same", "owner"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain(a.email)
    expect(r.stderr).toContain(second)
  })

  test("a member who is not an owner cannot change roles (exit 7)", async () => {
    const { join } = await team()
    const ben = await join("Ben Member")
    expect((await ben.box.run(["member", "role", "@me", "owner"])).exitCode).toBe(7)
  })
})

describe("member remove", () => {
  test("refuses without --yes when it cannot prompt, and removes nobody", async () => {
    const { box, join, members } = await team()
    const ben = await join("Ben Member")
    const r = await box.run(["member", "remove", ben.email])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--yes")
    expect(await members()).toHaveLength(2)
  })

  test("--yes removes the member, who then loses access", async () => {
    const { box, join, members } = await team()
    const ben = await join("Ben Member")
    const r = await box.run(["member", "remove", ben.email, "--yes"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect((await members()).map((m) => m.email)).not.toContain(ben.email)
    expect((await ben.box.run(["ws", "list", "--json"])).json()).toEqual([])
  })

  test("--json reports who was removed", async () => {
    const { box, join, members } = await team()
    const ben = await join("Ben Member")
    const id = (await members()).find((m) => m.email === ben.email)?.id
    const r = await box.run(["member", "remove", "Ben Member", "--yes", "--json"])
    expect(r.json()).toEqual({ id, email: ben.email, deleted: true })
  })

  test("the last owner cannot be removed (exit 6)", async () => {
    const { box, members } = await team()
    const r = await box.run(["member", "remove", "@me", "--yes"])
    expect(r.exitCode).toBe(6)
    expect(await members()).toHaveLength(1)
  })

  test("a member who is not an owner cannot remove others (exit 7)", async () => {
    const { box, join, ownerEmail, members } = await team()
    const ben = await join("Ben Member")
    const r = await ben.box.run(["member", "remove", ownerEmail, "--yes"])
    expect(r.exitCode).toBe(7)
    expect(await members(box)).toHaveLength(2)
  })

  test("an unknown member exits 5", async () => {
    const { box } = await team()
    expect((await box.run(["member", "remove", "ghost@example.com", "--yes"])).exitCode).toBe(5)
  })
})

describe("member leave", () => {
  test("refuses without --yes, then --yes leaves the workspace", async () => {
    const { box, join, members } = await team()
    const ben = await join("Ben Member")
    const refused = await ben.box.run(["member", "leave"])
    expect(refused.exitCode).toBe(2)
    expect(refused.stderr).toContain("--yes")
    expect(await members(box)).toHaveLength(2)

    const r = await ben.box.run(["member", "leave", "--yes"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect((await members(box)).map((m) => m.email)).not.toContain(ben.email)
    expect((await ben.box.run(["ws", "list", "--json"])).json()).toEqual([])
  })

  test("--json reports the membership that ended", async () => {
    const { box, join, members } = await team()
    const ben = await join("Ben Member")
    const id = (await members()).find((m) => m.email === ben.email)?.id
    const r = await ben.box.run(["member", "leave", "--yes", "--json"])
    expect(r.json()).toEqual({ id, email: ben.email, deleted: true })
    expect(await members(box)).toHaveLength(1)
  })

  test("the last owner cannot leave (exit 6), but can once there is another owner", async () => {
    const { box, join, members } = await team()
    const ben = await join("Ben Member")
    const stuck = await box.run(["member", "leave", "--yes"])
    expect(stuck.exitCode).toBe(6)
    expect(stuck.stderr).toContain("owner")

    await box.run(["member", "role", ben.email, "owner"])
    expect((await box.run(["member", "leave", "--yes"])).exitCode).toBe(0)
    expect((await members(ben.box)).map((m) => m.email)).toEqual([ben.email])
  })
})
