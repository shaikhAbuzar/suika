import type { Entry, SortMode } from "./types.ts"

/** Apply filter + sort to raw entries. Dirs/buckets always sort before files. */
export function viewOf(entries: Entry[], filter: string, sort: SortMode, reverse: boolean): Entry[] {
  let view = entries
  if (filter) {
    const f = filter.toLowerCase()
    view = view.filter((e) => e.name.toLowerCase().includes(f))
  }
  const dir = reverse ? -1 : 1
  const groupOf = (e: Entry) => (e.kind === "action" ? 2 : e.kind === "file" ? 1 : 0)
  return [...view].sort((a, b) => {
    const aGroup = groupOf(a)
    const bGroup = groupOf(b)
    if (aGroup !== bGroup) return aGroup - bGroup
    // pinned buckets stay on top regardless of sort mode or direction
    const aPin = a.kind === "bucket" && a.pinned ? 0 : 1
    const bPin = b.kind === "bucket" && b.pinned ? 0 : 1
    if (aPin !== bPin) return aPin - bPin
    switch (sort) {
      case "size":
        return ((a.size ?? -1) - (b.size ?? -1)) * dir || a.name.localeCompare(b.name)
      case "mtime":
        return ((a.mtime?.getTime() ?? 0) - (b.mtime?.getTime() ?? 0)) * dir || a.name.localeCompare(b.name)
      case "name":
        return a.name.localeCompare(b.name) * dir
    }
  })
}

export function clampCursor(cursor: number, viewLen: number): number {
  if (viewLen === 0) return 0
  return Math.max(0, Math.min(cursor, viewLen - 1))
}

/** Keep cursor visible inside a window of `height` rows. */
export function scrollFor(cursor: number, scroll: number, height: number, viewLen: number): number {
  if (height <= 0) return 0
  let s = scroll
  if (cursor < s) s = cursor
  if (cursor >= s + height) s = cursor - height + 1
  return Math.max(0, Math.min(s, Math.max(0, viewLen - height)))
}

export function moveCursor(cursor: number, delta: number, viewLen: number): number {
  return clampCursor(cursor + delta, viewLen)
}

export function nextSort(sort: SortMode): SortMode {
  switch (sort) {
    case "name":
      return "size"
    case "size":
      return "mtime"
    case "mtime":
      return "name"
  }
}

export function indexOfName(view: Entry[], name: string): number {
  const idx = view.findIndex((e) => e.name === name)
  return idx === -1 ? 0 : idx
}
