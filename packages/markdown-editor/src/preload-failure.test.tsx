import { afterEach, describe, expect, it } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MarkdownEditor, preloadMarkdownEditor } from "./index"
import { resetMarkdownEditorForTests } from "./markdown-editor"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const offline = () => Promise.reject(new Error("offline"))

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  resetMarkdownEditorForTests()
})

describe("when the editor chunk cannot be fetched", () => {
  it("leaves a working textarea behind and does not throw", async () => {
    resetMarkdownEditorForTests(offline)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(<MarkdownEditor label="d" value="still here" onChange={() => {}} />)
    })

    const area = host.querySelector("textarea.cm-plain") as HTMLTextAreaElement
    expect(area.value).toBe("still here")
    expect(host.querySelector("[data-editor]")?.getAttribute("data-editor")).toBe("loading")
    expect(host.querySelector(".cm-content")).toBeNull()
  })

  it("does not cache the failure: the next preload retries and succeeds", async () => {
    resetMarkdownEditorForTests(offline)
    await expect(preloadMarkdownEditor()).rejects.toThrow("offline")

    resetMarkdownEditorForTests() // back to the real loader; `loading` was already cleared by the failure
    await expect(preloadMarkdownEditor()).resolves.toBeDefined()
  })
})
