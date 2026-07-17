/** @jsxImportSource @opentui/react */
import { describe, expect, test } from "bun:test"
import { renderApp, renderAppLoading, seedStore } from "./helpers.tsx"

async function frameAt(w: number, h: number): Promise<string[]> {
  const setup = await renderApp(w, h)
  const lines = setup.captureCharFrame().split("\n")
  if (lines.at(-1) === "") lines.pop()
  setup.renderer.destroy()
  return lines
}

describe("layout", () => {
  for (const [w, h] of [
    [100, 20],
    [80, 16],
    [71, 16],
    [171, 24],
    [249, 55],
  ] as Array<[number, number]>) {
    test(`${w}x${h}: exact grid, closed borders, intact status bar`, async () => {
      const lines = await frameAt(w, h)
      expect(lines.length).toBe(h)
      for (const l of lines) expect(l.length).toBe(w)

      // pane borders open on the first row and close on the row above the status bar
      expect(lines[0]!.startsWith("┌")).toBe(true)
      expect(lines[0]!.endsWith("┐")).toBe(true)
      expect(lines[h - 2]!.startsWith("└")).toBe(true)
      expect(lines[h - 2]!.endsWith("┘")).toBe(true)

      // status bar is one intact row: profile on the left, full quit hint on the right
      expect(lines[h - 1]!).toContain("default @ us-east-1")
      expect(lines[h - 1]!).toContain("q:quit")

      // rows never wrap: every entry stays on its own single line, and pinned
      // buckets sort to the top with a pin icon
      // (names may be middle-truncated at narrow widths, so match a stable prefix)
      expect(lines[1]!).toContain("⚲  shared-datalake") // pin glyph before the name
      expect(lines[2]!).toContain("acme-data-bucket")
      expect(lines[3]!).toContain("✗ config-l") // denied mark sits before the name
      expect(lines[4]!).toContain("+ pin a bucket") // add-bucket action row sorts last
    }, 20_000)
  }

  test("wide panes show dates on the entry row itself", async () => {
    const lines = await frameAt(100, 20)
    expect(lines[2]!).toContain("Dec 23  2025") // acme-data-bucket row
    expect(lines[3]!).toContain("5.2K") // size column on the local pane file
  }, 20_000)

  test("narrow panes drop the date column instead of wrapping", async () => {
    const lines = await frameAt(80, 16)
    expect(lines[2]!).not.toContain("Dec 23")
    expect(lines[2]!.length).toBe(80)
  }, 20_000)

  test("loading → ready transition leaves no stale offset (regression)", async () => {
    // the loading screen is a padded <box>; if the reconciler reuses it for the
    // main layout without resetting padding, the whole frame shifts by (2,2)
    const setup = await renderAppLoading(100, 24)
    expect(setup.captureCharFrame()).toContain("loading…")

    seedStore()
    await setup.renderOnce()
    const lines = setup.captureCharFrame().split("\n")
    if (lines.at(-1) === "") lines.pop()

    expect(lines[0]!.startsWith("┌")).toBe(true) // stale padding would indent this
    expect(lines[0]!.endsWith("┐")).toBe(true)
    expect(lines[22]!.startsWith("└")).toBe(true)
    expect(lines[22]!.endsWith("┘")).toBe(true)
    expect(lines[21]!).toContain("items · name") // footer inside the pane
    expect(lines[23]!).toContain("q:quit") // status bar intact on the last row
    setup.renderer.destroy()
  }, 20_000)

  test("below the minimum size a btop-style prompt is shown", async () => {
    const lines = await frameAt(60, 12)
    const text = lines.join("\n")
    expect(text).toContain("Terminal size too small")
    expect(text).toContain("Width = 60, Height = 12")
    expect(text).toContain("Width = 70, Height = 16")
    expect(text).not.toContain("┌") // no panes rendered
  }, 20_000)
})
