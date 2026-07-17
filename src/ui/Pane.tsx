import { truncateMiddle } from "../core/format.ts"
import { locationTitle } from "../core/keys.ts"
import { paneView, setListHeight, useApp } from "../core/store.ts"
import type { PaneSide } from "../core/types.ts"
import { ListWindow } from "./ListWindow.tsx"
import { theme } from "./theme.ts"

interface Props {
  side: PaneSide
  width: number
  height: number
}

export function Pane({ side, width, height }: Props) {
  const pane = useApp((s) => s.panes[side])
  const active = useApp((s) => s.active === side)
  const view = paneView(side)

  const listHeight = Math.max(1, height - 3) // top/bottom border (2) + footer (1)
  if (active) setListHeight(listHeight)

  const innerWidth = Math.max(10, width - 2)
  const title = ` ${truncateMiddle(locationTitle(pane.location), Math.max(4, innerWidth - 2))} `

  const counts = `${view.length}${pane.entries.length !== view.length ? `/${pane.entries.length}` : ""}${
    pane.truncated ? "+" : ""
  }`
  const sel = pane.selected.size > 0 ? ` · ${pane.selected.size} selected` : ""
  const sortLabel = `${pane.sort}${pane.sortReverse ? "↓" : ""}`
  const filterLabel = pane.filterEditing
    ? ` /${pane.filter}▏`
    : pane.filter
      ? ` /${pane.filter}`
      : ""
  const spin = pane.loading ? " ⟳" : ""
  const footer = ` ${counts} items${sel} · ${sortLabel}${filterLabel}${spin}`

  return (
    <box
      width={width}
      height={height}
      border
      borderColor={active ? theme.borderActive : theme.border}
      title={title}
      titleColor={active ? theme.titleActive : theme.dim}
      flexDirection="column"
    >
      <box width={innerWidth} height={listHeight} flexDirection="column">
        <ListWindow
          view={view}
          cursor={pane.cursor}
          scroll={pane.scroll}
          width={innerWidth}
          height={listHeight}
          active={active}
          selected={pane.selected}
          loading={pane.loading}
          error={pane.error}
          errorHint={pane.errorHint}
          truncated={pane.truncated}
        />
      </box>
      <text wrapMode="none" height={1} fg={pane.filterEditing ? theme.info : theme.dim} bg={theme.statusBg}>
        {truncateMiddle(footer, innerWidth)}
      </text>
    </box>
  )
}
