import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  getBacklogExpanded,
  getBoardAssignees,
  setBacklogExpanded,
  setBoardAssignees,
} from "../src/lib/preferences"

const KEY = "intesa-preferences"

class MemoryStorage {
  data = new Map<string, string>()
  getItem = (k: string) => this.data.get(k) ?? null
  setItem = (k: string, v: string) => void this.data.set(k, v)
}

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
})

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original)
  else Reflect.deleteProperty(globalThis, "localStorage")
})

describe("backlog preference", () => {
  test("is collapsed until the user opens it", () => {
    expect(getBacklogExpanded()).toBe(false)
  })

  test("remembers the choice either way", () => {
    setBacklogExpanded(true)
    expect(getBacklogExpanded()).toBe(true)
    setBacklogExpanded(false)
    expect(getBacklogExpanded()).toBe(false)
  })

  test("saving it keeps the board filters, and the other way round", () => {
    setBoardAssignees("p1", ["u1"])
    setBacklogExpanded(true)
    expect(getBoardAssignees("p1")).toEqual(["u1"])
    setBoardAssignees("p2", [])
    expect(getBacklogExpanded()).toBe(true)
  })

  test("entries written before the preference existed read as collapsed", () => {
    storage.setItem(KEY, JSON.stringify({ v: 1, boardAssignees: { p1: ["u1"] } }))
    expect(getBacklogExpanded()).toBe(false)
    expect(getBoardAssignees("p1")).toEqual(["u1"])
  })

  test.each([
    ["a string", "yes"],
    ["a number", 1],
    ["null", null],
  ])("a stored value that is %s counts as collapsed", (_, value) => {
    storage.setItem(KEY, JSON.stringify({ v: 1, boardAssignees: {}, backlogExpanded: value }))
    expect(getBacklogExpanded()).toBe(false)
  })

  test("an unknown version or broken JSON is ignored", () => {
    storage.setItem(KEY, JSON.stringify({ v: 2, backlogExpanded: true }))
    expect(getBacklogExpanded()).toBe(false)
    storage.setItem(KEY, "{not json")
    expect(getBacklogExpanded()).toBe(false)
  })

  test("unavailable storage falls back to collapsed and does not throw on save", () => {
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("blocked")
      },
      configurable: true,
    })
    expect(getBacklogExpanded()).toBe(false)
    expect(() => setBacklogExpanded(true)).not.toThrow()
  })
})
