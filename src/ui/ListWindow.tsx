import { TextAttributes } from "@opentui/core"
import { humanBytes, humanDate, padEndTo, padStartTo, truncateMiddle } from "../core/format.ts"
import type { Entry } from "../core/types.ts"
import { theme } from "./theme.ts"

interface Props {
  view: Entry[]
  cursor: number
  scroll: number
  width: number
  height: number
  active: boolean
  selected: Set<string>
  loading: boolean
  error: string | null
  errorHint: string | null
  truncated: boolean
}

const SIZE_W = 7
const DATE_W = 12
// drop columns as the pane narrows so rows never exceed the content width
const MIN_WIDTH_FOR_DATE = 44
const MIN_WIDTH_FOR_SIZE = 30

function accessGlyph(e: Entry): string {
  switch (e.access) {
    case "checking":
      return "…"
    case "denied":
      return "✗"
    case "unknown":
      return "?"
    default:
      return " "
  }
}

function rowText(e: Entry, width: number, isSelected: boolean): string {
  const marker = isSelected ? "▸" : " "
  if (e.kind === "action") {
    return padEndTo(truncateMiddle(`${marker} + ${e.name}`, width), width)
  }
  const withDate = width >= MIN_WIDTH_FOR_DATE
  const withSize = width >= MIN_WIDTH_FOR_SIZE

  const sizeCol = e.kind === "file" ? (e.note ?? humanBytes(e.size)) : ""

  let right = ""
  if (withSize) right += padStartTo(sizeCol, SIZE_W)
  if (withDate) right += " " + padStartTo(humanDate(e.mtime), DATE_W)
  if (right) right += " "

  const nameW = Math.max(4, width - 2 - right.length)
  let displayName = e.kind === "dir" ? e.name + "/" : e.name
  if (e.kind === "bucket") {
    // fixed 3-char prefix (pin, access mark, space) keeps names aligned:
    // "⚲✗ " pinned+denied · "⚲  " pinned · " ✗ " denied · "   " accessible
    displayName = (e.pinned ? "⚲" : " ") + accessGlyph(e) + " " + displayName
  }
  return `${marker} ${padEndTo(truncateMiddle(displayName, nameW), nameW)}${right}`
}

function rowFg(e: Entry, isSelected: boolean): string {
  if (isSelected) return theme.selectedFg
  if (e.kind === "action") return theme.dim
  if (e.kind === "bucket") return e.access === "denied" ? theme.error : theme.bucket
  if (e.kind === "dir") return theme.dir
  if (e.note) return theme.dim
  return theme.text
}

export function ListWindow(props: Props) {
  const { view, cursor, scroll, width, height, active, selected } = props

  // keyed branches: see the note in App.tsx — swapping unkeyed boxes with
  // different padding leaves stale layout props on the reused renderable
  if (props.error) {
    return (
      <box key="list-error" flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text wrapMode="none" fg={theme.error}>{props.error}</text>
        {props.errorHint ? <text fg={theme.dim}>{props.errorHint}</text> : null}
      </box>
    )
  }

  if (view.length === 0) {
    return (
      <box key="list-empty" paddingLeft={1}>
        <text wrapMode="none" fg={theme.dim}>
          {props.loading ? "loading…" : "(empty)"}
        </text>
      </box>
    )
  }

  const rows = []
  const end = Math.min(view.length, scroll + height)
  for (let i = scroll; i < end; i++) {
    const e = view[i]!
    const isCursor = i === cursor
    const isSelected = selected.has(e.key)
    rows.push(
      <text
        key={e.key}
        wrapMode="none"
        height={1}
        fg={isCursor && !isSelected ? theme.text : rowFg(e, isSelected)}
        bg={isCursor ? (active ? theme.cursorBg : theme.cursorBgInactive) : undefined}
        attributes={e.kind === "bucket" && e.pinned ? TextAttributes.BOLD : TextAttributes.NONE}
      >
        {rowText(e, width, isSelected)}
      </text>,
    )
  }
  if (props.truncated && end === view.length && end - scroll < height) {
    rows.push(
      <text key="__more" wrapMode="none" height={1} fg={theme.info}>
        {`  … listing truncated — press L to load more`}
      </text>,
    )
  }
  return (
    <box key="list-rows" flexDirection="column">
      {rows}
    </box>
  )
}
