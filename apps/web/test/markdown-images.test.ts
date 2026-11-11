import { describe, expect, test } from "bun:test"
import { removeImage, replaceUrl } from "../src/lib/markdown-images"

const URL = "blob:http://localhost:5173/3f2a-41"

describe("removeImage", () => {
  test("takes an image on its own line with the line", () => {
    expect(removeImage(`Steps:\n![Shot](${URL})\nThen this.`, URL)).toBe("Steps:\nThen this.")
    expect(removeImage(`![Shot](${URL})\nThen this.`, URL)).toBe("Then this.")
    expect(removeImage(`Steps:\n![Shot](${URL})`, URL)).toBe("Steps:\n")
  })

  test("keeps the line break of an image inside a line", () => {
    expect(removeImage(`See ![Shot](${URL})\nnext`, URL)).toBe("See \nnext")
  })

  test("handles escaped alt text and titles, and leaves other images alone", () => {
    const md = String.raw`![A \[1\]](<${URL}> "t")` + `\n![Other](${URL}9)\n`
    expect(removeImage(md, URL)).toBe(`![Other](${URL}9)\n`)
  })
})

test("replaceUrl points every link at the new URL", () => {
  expect(replaceUrl(`![a](${URL}) and [b](${URL})`, URL, "/api/x")).toBe(
    "![a](/api/x) and [b](/api/x)",
  )
})
