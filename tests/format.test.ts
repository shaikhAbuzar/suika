import { describe, expect, test } from "bun:test"
import { humanBytes, humanDate, padEndTo, padStartTo, progressBar, truncateEnd, truncateMiddle } from "../src/core/format.ts"

describe("humanBytes", () => {
  test("bytes", () => expect(humanBytes(512)).toBe("512B"))
  test("kilobytes", () => expect(humanBytes(2048)).toBe("2.0K"))
  test("large values drop decimals", () => expect(humanBytes(150 * 1024 * 1024)).toBe("150M"))
  test("gigabytes", () => expect(humanBytes(5.5 * 1024 ** 3)).toBe("5.5G"))
  test("undefined", () => expect(humanBytes(undefined)).toBe(""))
})

describe("humanDate", () => {
  const now = new Date("2026-07-17T12:00:00")
  test("same year shows time", () => {
    expect(humanDate(new Date("2026-03-05T09:07:00"), now)).toBe("Mar 05 09:07")
  })
  test("other year shows year", () => {
    expect(humanDate(new Date("2024-12-31T09:07:00"), now)).toBe("Dec 31  2024")
  })
  test("undefined", () => expect(humanDate(undefined, now)).toBe(""))
})

describe("truncate/pad", () => {
  test("truncateMiddle keeps ends", () => expect(truncateMiddle("abcdefghij", 7)).toBe("abc…hij"))
  test("truncateMiddle no-op when short", () => expect(truncateMiddle("abc", 7)).toBe("abc"))
  test("truncateEnd", () => expect(truncateEnd("abcdefghij", 5)).toBe("abcd…"))
  test("padEndTo", () => expect(padEndTo("ab", 4)).toBe("ab  "))
  test("padEndTo clips", () => expect(padEndTo("abcdef", 4)).toBe("abcd"))
  test("padStartTo", () => expect(padStartTo("ab", 4)).toBe("  ab"))
})

describe("progressBar", () => {
  test("half", () => expect(progressBar(50, 100, 4)).toBe("██░░"))
  test("done", () => expect(progressBar(100, 100, 4)).toBe("████"))
  test("zero total", () => expect(progressBar(0, 0, 4)).toBe("░░░░"))
})
