import { describe, expect, test } from "bun:test"
import { childNameFor, joinPrefix, leafName, locationKey, parentLocation, parentPrefix, s3Uri } from "../src/core/keys.ts"

describe("parentPrefix", () => {
  test("nested prefix", () => expect(parentPrefix("a/b/c/")).toBe("a/b/"))
  test("file key", () => expect(parentPrefix("a/b/c.txt")).toBe("a/b/"))
  test("top-level prefix", () => expect(parentPrefix("a/")).toBe(""))
  test("top-level key", () => expect(parentPrefix("a")).toBe(""))
  test("empty", () => expect(parentPrefix("")).toBe(""))
})

describe("leafName", () => {
  test("dir key", () => expect(leafName("a/b/c/")).toBe("c"))
  test("file key", () => expect(leafName("a/b/c.txt")).toBe("c.txt"))
  test("top-level", () => expect(leafName("a")).toBe("a"))
})

describe("joinPrefix", () => {
  test("dir", () => expect(joinPrefix("a/", "b", true)).toBe("a/b/"))
  test("file", () => expect(joinPrefix("a/", "b.txt", false)).toBe("a/b.txt"))
  test("root", () => expect(joinPrefix("", "b", true)).toBe("b/"))
})

describe("s3Uri", () => {
  test("basic", () => expect(s3Uri("bkt", "a/b.txt")).toBe("s3://bkt/a/b.txt"))
})

describe("parentLocation / childNameFor", () => {
  test("prefix → parent prefix", () => {
    const loc = { type: "s3", profile: "p", bucket: "b", prefix: "a/b/" } as const
    expect(parentLocation(loc)).toEqual({ type: "s3", profile: "p", bucket: "b", prefix: "a/" })
    expect(childNameFor(loc)).toBe("b")
  })
  test("bucket root → bucket list", () => {
    const loc = { type: "s3", profile: "p", bucket: "b", prefix: "" } as const
    expect(parentLocation(loc)).toEqual({ type: "s3-buckets", profile: "p" })
    expect(childNameFor(loc)).toBe("b")
  })
  test("bucket list has no parent", () => {
    expect(parentLocation({ type: "s3-buckets", profile: "p" })).toBeNull()
  })
  test("local dir", () => {
    const loc = { type: "local", dir: "/tmp/foo" } as const
    expect(parentLocation(loc)).toEqual({ type: "local", dir: "/tmp" })
    expect(childNameFor(loc)).toBe("foo")
  })
  test("filesystem root has no parent", () => {
    expect(parentLocation({ type: "local", dir: "/" })).toBeNull()
  })
})

describe("locationKey", () => {
  test("distinct per location", () => {
    const a = locationKey({ type: "s3", profile: "p", bucket: "b", prefix: "x/" })
    const b = locationKey({ type: "s3", profile: "p", bucket: "b", prefix: "y/" })
    expect(a).not.toBe(b)
  })
})
