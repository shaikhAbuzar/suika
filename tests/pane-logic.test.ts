import { describe, expect, test } from "bun:test"
import { clampCursor, indexOfName, nextSort, scrollFor, viewOf } from "../src/core/pane-logic.ts"
import type { Entry } from "../src/core/types.ts"

const mk = (name: string, kind: Entry["kind"], size?: number, mtime?: number): Entry => ({
  name,
  kind,
  key: name,
  size,
  mtime: mtime !== undefined ? new Date(mtime) : undefined,
})

const entries: Entry[] = [
  mk("zebra.txt", "file", 10, 3000),
  mk("alpha.txt", "file", 30, 1000),
  mk("beta", "dir"),
  mk("Alpha2.txt", "file", 20, 2000),
]

describe("viewOf", () => {
  test("dirs sort before files", () => {
    const v = viewOf(entries, "", "name", false)
    expect(v[0]!.name).toBe("beta")
  })
  test("name sort is case-insensitive-ish (localeCompare)", () => {
    const v = viewOf(entries, "", "name", false)
    expect(v.map((e) => e.name)).toEqual(["beta", "alpha.txt", "Alpha2.txt", "zebra.txt"])
  })
  test("filter is case-insensitive substring", () => {
    const v = viewOf(entries, "ALPHA", "name", false)
    expect(v.map((e) => e.name).sort()).toEqual(["Alpha2.txt", "alpha.txt"])
  })
  test("size sort", () => {
    const v = viewOf(entries, "", "size", false)
    expect(v.map((e) => e.name)).toEqual(["beta", "zebra.txt", "Alpha2.txt", "alpha.txt"])
  })
  test("mtime sort reversed", () => {
    const v = viewOf(entries, "", "mtime", true)
    expect(v.filter((e) => e.kind === "file").map((e) => e.name)).toEqual(["zebra.txt", "Alpha2.txt", "alpha.txt"])
  })
  test("does not mutate input", () => {
    const before = entries.map((e) => e.name)
    viewOf(entries, "", "size", false)
    expect(entries.map((e) => e.name)).toEqual(before)
  })
})

describe("pinned buckets", () => {
  const buckets: Entry[] = [
    { name: "alpha", kind: "bucket", key: "alpha" },
    { name: "zzz-pinned", kind: "bucket", key: "zzz-pinned", pinned: true },
    { name: "beta", kind: "bucket", key: "beta" },
  ]
  test("pinned sort first regardless of name order", () => {
    expect(viewOf(buckets, "", "name", false).map((e) => e.name)).toEqual(["zzz-pinned", "alpha", "beta"])
  })
  test("pinned stay first even when sort is reversed", () => {
    expect(viewOf(buckets, "", "name", true).map((e) => e.name)).toEqual(["zzz-pinned", "beta", "alpha"])
  })
  test("action rows always sort last", () => {
    const withAction: Entry[] = [{ name: "aaa-action", kind: "action", key: "__a" }, ...buckets]
    expect(viewOf(withAction, "", "name", false).at(-1)?.name).toBe("aaa-action")
    expect(viewOf(withAction, "", "name", true).at(-1)?.name).toBe("aaa-action")
  })
})

describe("clampCursor", () => {
  test("empty view", () => expect(clampCursor(5, 0)).toBe(0))
  test("past end", () => expect(clampCursor(10, 3)).toBe(2))
  test("negative", () => expect(clampCursor(-1, 3)).toBe(0))
})

describe("scrollFor", () => {
  test("cursor above window scrolls up", () => expect(scrollFor(2, 5, 10, 100)).toBe(2))
  test("cursor below window scrolls down", () => expect(scrollFor(20, 5, 10, 100)).toBe(11))
  test("cursor inside window keeps scroll", () => expect(scrollFor(7, 5, 10, 100)).toBe(5))
  test("never scrolls past end", () => expect(scrollFor(99, 99, 10, 100)).toBe(90))
})

describe("nextSort", () => {
  test("cycles", () => {
    expect(nextSort("name")).toBe("size")
    expect(nextSort("size")).toBe("mtime")
    expect(nextSort("mtime")).toBe("name")
  })
})

describe("indexOfName", () => {
  test("found", () => expect(indexOfName(viewOf(entries, "", "name", false), "zebra.txt")).toBe(3))
  test("missing falls back to 0", () => expect(indexOfName(entries, "nope")).toBe(0))
})
