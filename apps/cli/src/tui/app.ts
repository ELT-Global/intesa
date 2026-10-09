// `intesa board`: wires the store, the keymap and the view to an OpenTUI renderer. Loaded only
// by the board command, so no other command pays for OpenTUI.
import { type CliRenderer, createCliRenderer, type KeyEvent, type PasteEvent } from "@opentui/core"
import { type BoardApi, CliError, type Ctx, connect, type Start } from "./api"
import { handleKey } from "./keymap"
import type { Host } from "./state"
import { createStore, type Lost, POLL_MS } from "./store"
import { createView } from "./view"

// How long quitting waits for changes still being saved.
const SAVE_WAIT_MS = 5000

export function createBoardApp(
  renderer: CliRenderer,
  api: BoardApi,
  start: Start,
  opts: { pollMs?: number } = {},
) {
  let finish: (lost: Promise<Lost[]>) => void = () => {}
  const done = new Promise<Lost[]>((resolve) => {
    finish = resolve
  })
  const onKey = (key: KeyEvent) => handleKey(store, key)
  // Pasted text goes into whatever input is open, on one line.
  const onPaste = (event: PasteEvent) => {
    const top = store.top()
    const pasted = new TextDecoder().decode(event.bytes).replace(/\s*[\r\n]+\s*/g, " ")
    if (top?.kind === "input") store.inputChange(top, top.value + pasted)
    else if (top?.kind === "picker") store.pickerType(top, top.query + pasted)
  }
  const detachInput = () => {
    renderer.keyInput.off("keypress", onKey)
    renderer.keyInput.off("paste", onPaste)
  }
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
    // Keys stop here; the board stays up while the last changes are saved.
    quit() {
      detachInput()
      finish(store.close(SAVE_WAIT_MS))
    },
  }
  const store = createStore(api, start, host, opts)
  const view = createView(renderer, store, { unicode: start.unicode, color: start.color })
  const unsubscribe = store.subscribe(view.draw)
  renderer.keyInput.on("keypress", onKey)
  renderer.keyInput.on("paste", onPaste)
  renderer.on("resize", view.draw)
  view.draw()

  return {
    store,
    // Settles when the first load is done (or failed; the board then shows why).
    ready: store.init(),
    // Settles when the user has quit, with what could not be saved.
    done,
    dispose() {
      unsubscribe()
      store.dispose()
      detachInput()
      renderer.off("resize", view.draw)
    },
  }
}

export type BoardApp = ReturnType<typeof createBoardApp>

/** Runs the app until it is quit, and gives the terminal back however that ends. */
export async function session(renderer: CliRenderer, create: () => BoardApp): Promise<Lost[]> {
  let app: BoardApp | undefined
  try {
    app = create()
    return await app.done
  } finally {
    app?.dispose()
    renderer.destroy()
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
  const lost = await session(renderer, () =>
    createBoardApp(renderer, api, start, { pollMs: POLL_MS }),
  )
  // Said once the terminal is back, since the board can no longer show it. Without an error,
  // the server did not answer in time.
  const [first] = lost
  if (first) {
    const cause = first.err instanceof CliError ? first.err : undefined
    throw new CliError(lost.map((l) => l.text).join("\n"), {
      code: cause?.code ?? "NETWORK_ERROR",
      exitCode: cause?.exitCode ?? 1,
    })
  }
}
