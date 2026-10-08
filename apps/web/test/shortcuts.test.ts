import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { keyLabel } from "../src/components/projects/shortcut-help-dialog"
import { isModShortcut, isPlainShortcut } from "../src/lib/shortcuts"

type Init = Partial<KeyboardEvent> & { altGr?: boolean; inTypingTarget?: boolean }

function press(key: string, { altGr, inTypingTarget, ...init }: Init = {}): KeyboardEvent {
  return {
    key,
    repeat: false,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    getModifierState: (m: string) => m === "AltGraph" && !!altGr,
    target: { closest: () => (inTypingTarget ? {} : null) },
    ...init,
  } as unknown as KeyboardEvent
}

describe("isModShortcut", () => {
  test("uses Cmd on a Mac and Ctrl elsewhere", () => {
    expect(isModShortcut(press("/", { metaKey: true }), "/", true)).toBe(true)
    expect(isModShortcut(press("/", { ctrlKey: true }), "/", true)).toBe(false)
    expect(isModShortcut(press("/", { ctrlKey: true }), "/", false)).toBe(true)
    expect(isModShortcut(press("/", { metaKey: true }), "/", false)).toBe(false)
  })

  test("rejects extra modifiers, other keys and auto-repeat", () => {
    expect(isModShortcut(press("/", { ctrlKey: true, shiftKey: true }), "/", false)).toBe(false)
    expect(isModShortcut(press("/", { ctrlKey: true, altKey: true }), "/", false)).toBe(false)
    expect(isModShortcut(press("a", { ctrlKey: true }), "/", false)).toBe(false)
    expect(isModShortcut(press("/", { ctrlKey: true, repeat: true }), "/", false)).toBe(false)
  })
})

describe("isPlainShortcut", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document")
  let dialogOpen = false
  beforeEach(() => {
    dialogOpen = false
    Object.defineProperty(globalThis, "document", {
      value: { querySelector: () => (dialogOpen ? {} : null) },
      configurable: true,
    })
  })
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "document", original)
    else Reflect.deleteProperty(globalThis, "document")
  })

  test("fires for the bare key only", () => {
    expect(isPlainShortcut(press("n"), "n")).toBe(true)
    expect(isPlainShortcut(press("f"), "n")).toBe(false)
    expect(isPlainShortcut(press("n", { ctrlKey: true }), "n")).toBe(false)
    expect(isPlainShortcut(press("n", { metaKey: true }), "n")).toBe(false)
    expect(isPlainShortcut(press("n", { altKey: true }), "n")).toBe(false)
    expect(isPlainShortcut(press("n", { repeat: true }), "n")).toBe(false)
    expect(isPlainShortcut(press("n", { defaultPrevented: true }), "n")).toBe(false)
  })

  test("counts AltGr layouts as plain", () => {
    const altGr = press("[", { ctrlKey: true, altKey: true, altGr: true })
    expect(isPlainShortcut(altGr, "[")).toBe(true)
  })

  test("stays out of text fields, menus and dialogs", () => {
    expect(isPlainShortcut(press("n", { inTypingTarget: true }), "n")).toBe(false)
    dialogOpen = true
    expect(isPlainShortcut(press("n"), "n")).toBe(false)
  })

  test("requires Shift only when asked to", () => {
    const shifted = press("ArrowLeft", { shiftKey: true })
    expect(isPlainShortcut(shifted, "ArrowLeft", { shift: true })).toBe(true)
    expect(isPlainShortcut(press("ArrowLeft"), "ArrowLeft", { shift: true })).toBe(false)
  })
})

describe("keyLabel", () => {
  test("writes modifiers as symbols on a Mac and as words elsewhere", () => {
    expect(["Mod", "Shift", "Alt"].map((k) => keyLabel(k, true))).toEqual(["⌘", "⇧", "⌥"])
    expect(["Mod", "Shift", "Alt"].map((k) => keyLabel(k, false))).toEqual(["Ctrl", "Shift", "Alt"])
  })

  test("leaves ordinary keys as they are", () => {
    expect(keyLabel("N", true)).toBe("N")
    expect(keyLabel("←/→", false)).toBe("←/→")
  })
})
