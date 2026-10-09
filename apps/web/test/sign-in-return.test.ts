import { describe, expect, test } from "bun:test"
import { isSafeReturnPath } from "../src/lib/sign-in-return"

describe("isSafeReturnPath", () => {
  test("accepts in-app paths with a query", () => {
    expect(isSafeReturnPath("/device?code=BCDF-GHJK")).toBe(true)
    expect(isSafeReturnPath("/w/acme/home")).toBe(true)
  })

  test("rejects anything that could leave the app", () => {
    for (const path of [
      "//evil.example",
      `/${String.fromCharCode(92)}evil.example`,
      "https://evil.example/device",
      "javascript:alert(1)",
      "device",
      "",
      "/\t/evil.example",
    ]) {
      expect(isSafeReturnPath(path)).toBe(false)
    }
  })
})
