import { describe, expect, test } from "bun:test"
import { keySpec, lookupAction } from "../src/keymap.ts"

const key = (name: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {}, sequence = name) => ({
  name,
  sequence,
  ctrl: mods.ctrl ?? false,
  meta: mods.meta ?? false,
  shift: mods.shift ?? false,
})

describe("keySpec", () => {
  test("plain letter", () => expect(keySpec(key("j"))).toBe("j"))
  test("shifted letter", () => expect(keySpec(key("g", { shift: true }, "G"))).toBe("G"))
  test("ctrl combo", () => expect(keySpec(key("c", { ctrl: true }, "\x03"))).toBe("C-c"))
  test("space", () => expect(keySpec(key("space", {}, " "))).toBe("space"))
  test("shifted slash arrives as ?", () => expect(keySpec(key("/", { shift: true }, "?"))).toBe("?"))
  test("backtick", () => expect(keySpec(key("`"))).toBe("`"))
  test("named keys pass through", () => expect(keySpec(key("escape", {}, "\x1b"))).toBe("escape"))
})

describe("lookupAction", () => {
  test("j → cursor-down", () => expect(lookupAction(key("j"))).toBe("cursor-down"))
  test("? → help", () => expect(lookupAction(key("/", { shift: true }, "?"))).toBe("help"))
  test("/ → filter", () => expect(lookupAction(key("/"))).toBe("filter"))
  test("G → cursor-bottom", () => expect(lookupAction(key("g", { shift: true }, "G"))).toBe("cursor-bottom"))
  test("g → cursor-top", () => expect(lookupAction(key("g"))).toBe("cursor-top"))
  test("C-c → quit", () => expect(lookupAction(key("c", { ctrl: true }, "\x03"))).toBe("quit"))
  test("unbound key → null", () => expect(lookupAction(key("z"))).toBeNull())
})
