// `intesa board`: wires the store, the keymap and the view to an OpenTUI renderer. Loaded only
// by the board command, so no other command pays for OpenTUI.
import { type CliRenderer, createCliRenderer, type KeyEvent, type PasteEvent } from "@opentui/core"
import { type BoardApi, type Ctx, connect, type Start } from "./api"
import { handleKey } from "./keymap"
import { createView } from "./render"
import { createStore, type Host } from "./store"

export function createBoardApp(
  renderer: CliRenderer,
  api: BoardApi,
  start: Start,
  opts: { pollMs?: number } = {},
) {
  let finish = () => {}
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  const host: Host = {
    copy: (text) => renderer.copyToClipboardOSC52(text),
    async suspend(run) {
      renderer.suspend()
      try {
        return await run()
      } finally {
        renderer.resume()
      }
    },
    quit: () => finish(),
  }
  const store = createStore(api, start, host, opts)
  const view = createView(renderer, store, { unicode: start.unicode, color: start.color })
  const unsubscribe = store.subscribe(view.draw)

  const onKey = (key: KeyEvent) => handleKey(store, key)
  // Pasted text goes into whatever input is open, on one line.
  const onPaste = (event: PasteEvent) => {
    const top = store.top()
    const pasted = new TextDecoder().decode(event.bytes).replace(/\s*[\r\n]+\s*/g, " ")
    if (top?.kind === "input") store.inputChange(top, top.value + pasted)
    else if (top?.kind === "picker") store.pickerType(top, top.query + pasted)
  }
  renderer.keyInput.on("keypress", onKey)
  renderer.keyInput.on("paste", onPaste)
  renderer.on("resize", view.draw)
  view.draw()

  return {
    store,
    // Settles when the first load is done (or failed; the board then shows why).
    ready: store.init(),
    // Settles when the user quits.
    done,
    dispose() {
      unsubscribe()
      store.dispose()
      renderer.keyInput.off("keypress", onKey)
      renderer.keyInput.off("paste", onPaste)
      renderer.off("resize", view.draw)
    },
  }
}

export async function runBoard(ctx: Ctx, ref?: string) {
  // Resolved before the screen is taken over, so a bad key or a missing login prints normally.
  const { api, start } = await connect(ctx, ref)
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    screenMode: "alternate-screen",
    targetFps: 30,
  })
  const app = createBoardApp(renderer, api, start, { pollMs: 30_000 })
  try {
    await app.done
  } finally {
    app.dispose()
    renderer.destroy()
  }
}
