import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect } from "react"
import {
  confirmDelete,
  copyPresignedUrl,
  copyUri,
  cursorEntry,
  cycleSortMode,
  endFilter,
  filterBackspace,
  filterInput,
  goUp,
  initApp,
  loadMore,
  moveBy,
  moveTo,
  openEntry,
  otherSide,
  pageBy,
  refresh,
  requestDelete,
  requestQuit,
  setOverlay,
  showMetadata,
  showPreview,
  startFilter,
  switchProfile,
  toggleLocalPane,
  toggleSelect,
  toggleSortReverse,
  unpinBucket,
  useApp,
} from "./core/store.ts"
import { abortJob, clearFinishedJobs, resolveCollision, startTransfer } from "./core/transfers.ts"
import { keySpec, lookupAction } from "./keymap.ts"
import type { Overlay } from "./core/types.ts"
import { Pane } from "./ui/Pane.tsx"
import { StatusBar } from "./ui/StatusBar.tsx"
import { OverlayHost } from "./ui/overlays/Overlays.tsx"
import { theme } from "./ui/theme.ts"

export const MIN_WIDTH = 70
export const MIN_HEIGHT = 16

function printableOf(key: KeyEvent): string | null {
  const seq = key.sequence
  if (key.ctrl || key.meta) return null
  if (seq && seq.length === 1 && seq.charCodeAt(0) >= 0x20 && seq.charCodeAt(0) !== 0x7f) return seq
  return null
}

export function App() {
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  const ready = useApp((s) => s.ready)
  const fatal = useApp((s) => s.fatal)

  useEffect(() => {
    // tests drive the store themselves; a real init would hit AWS
    if (!useApp.getState().ready && !process.env.SUIKA_TEST) void initApp()
  }, [])

  const exit = () => {
    renderer.destroy()
    process.exit(0)
  }

  useKeyboard((key) => {
    if (key.eventType === "release") return
    const st = useApp.getState()
    if (!st.ready) {
      if (keySpec(key) === "C-c" || key.name === "q") exit()
      return
    }
    const spec = keySpec(key)
    if (st.overlay) {
      handleOverlayKey(st.overlay, key, spec, exit)
      return
    }

    const side = st.active
    const pane = st.panes[side]

    if (pane.filterEditing) {
      if (spec === "escape") return endFilter(side, false)
      if (spec === "return") return endFilter(side, true)
      if (spec === "backspace") return filterBackspace(side)
      if (spec === "down" || spec === "C-n") return moveBy(side, 1)
      if (spec === "up" || spec === "C-p") return moveBy(side, -1)
      const ch = printableOf(key)
      if (ch) filterInput(side, ch)
      return
    }

    switch (lookupAction(key)) {
      case "cursor-down": return moveBy(side, 1)
      case "cursor-up": return moveBy(side, -1)
      case "cursor-top": return moveTo(side, "top")
      case "cursor-bottom": return moveTo(side, "bottom")
      case "page-down": return pageBy(side, 1)
      case "page-up": return pageBy(side, -1)
      case "switch-pane": return useApp.setState({ active: otherSide(side) })
      case "open": return openEntry(side)
      case "up": return goUp(side)
      case "select": return toggleSelect(side)
      case "filter": return startFilter(side)
      case "sort": return cycleSortMode(side)
      case "sort-reverse": return toggleSortReverse(side)
      case "copy-uri": return void copyUri(side)
      case "presign": return void copyPresignedUrl(side)
      case "copy": return void startTransfer("copy")
      case "move": return void startTransfer("move")
      case "delete": return requestDelete(side)
      case "rename": return openRename(side)
      case "refresh": return refresh(side)
      case "load-more": return void loadMore(side)
      case "preview": return void showPreview(side)
      case "metadata": return void showMetadata(side)
      case "profile": return setOverlay({ kind: "profile", cursor: currentProfileIndex() })
      case "pin-bucket": return setOverlay({ kind: "pin-bucket", side })
      case "toggle-local": return toggleLocalPane(side)
      case "transfers": return setOverlay({ kind: "transfers", cursor: 0 })
      case "help": return setOverlay({ kind: "help" })
      case "quit": return requestQuit(exit)
      case "escape":
        if (pane.filter) endFilter(side, false)
        return
    }
  })

  // NOTE: every top-level branch below returns a keyed <box>. The OpenTUI React
  // reconciler reuses a renderable when the element type matches, and props that
  // disappear between branches (e.g. padding) are not reliably reset — a stale
  // padding shifts the whole frame. Distinct keys force a fresh renderable.
  if (fatal) {
    return (
      <box key="app-fatal" padding={2} flexDirection="column">
        <text fg={theme.error}>suika failed to start: {fatal}</text>
        <text fg={theme.dim}>press q to exit</text>
      </box>
    )
  }
  if (dims.width < MIN_WIDTH || dims.height < MIN_HEIGHT) {
    return (
      <box
        key="app-too-small"
        width={dims.width}
        height={dims.height}
        alignItems="center"
        justifyContent="center"
        flexDirection="column"
      >
        <text wrapMode="none" fg={theme.error}>Terminal size too small:</text>
        <text wrapMode="none" fg={theme.text}>
          {`  Width = ${dims.width}, Height = ${dims.height}  `}
        </text>
        <text wrapMode="none" fg={theme.dim}>Needed to run suika:</text>
        <text wrapMode="none" fg={theme.text}>
          {`  Width = ${MIN_WIDTH}, Height = ${MIN_HEIGHT}  `}
        </text>
      </box>
    )
  }
  if (!ready) {
    return (
      <box key="app-loading" padding={2}>
        <text fg={theme.dim}>loading…</text>
      </box>
    )
  }

  const paneH = dims.height - 1
  const leftW = Math.floor(dims.width / 2)
  return (
    <box key="app-main" flexDirection="column" width={dims.width} height={dims.height}>
      <box flexDirection="row" flexGrow={1}>
        <Pane side="left" width={leftW} height={paneH} />
        <Pane side="right" width={dims.width - leftW} height={paneH} />
      </box>
      <StatusBar width={dims.width} />
      <OverlayHost />
    </box>
  )
}

function currentProfileIndex(): number {
  const st = useApp.getState()
  const idx = st.profiles.findIndex((p) => p.name === st.profile)
  return idx === -1 ? 0 : idx
}

function openRename(side: ReturnType<typeof useApp.getState>["active"]): void {
  const st = useApp.getState()
  if (st.panes[side].location.type === "s3-buckets") return
  const entry = cursorEntry(side)
  if (!entry) return
  setOverlay({ kind: "rename", side, entry, error: null })
}

function handleOverlayKey(ov: Overlay, key: KeyEvent, spec: string, exit: () => void): void {
  const close = () => setOverlay(null)
  switch (ov.kind) {
    case "help":
      if (spec === "escape" || spec === "q" || spec === "?") close()
      return
    case "profile": {
      const st = useApp.getState()
      const n = st.profiles.length
      if (spec === "j" || spec === "down") setOverlay({ ...ov, cursor: Math.min(ov.cursor + 1, n - 1) })
      else if (spec === "k" || spec === "up") setOverlay({ ...ov, cursor: Math.max(ov.cursor - 1, 0) })
      else if (spec === "return") {
        const p = st.profiles[ov.cursor]
        if (p) void switchProfile(p.name)
      } else if (spec === "escape" || spec === "q" || spec === "p") close()
      return
    }
    case "pin-bucket":
      if (spec === "escape") close()
      return
    case "metadata":
      if (spec === "escape" || spec === "q" || spec === "i" || spec === "return") close()
      return
    case "preview":
      if (spec === "escape" || spec === "q") close()
      return
    case "confirm-delete":
      if (spec === "escape") close()
      else if (!ov.needTyped && (spec === "y" || spec === "return")) void confirmDelete()
      return
    case "unpin-bucket":
      if (spec === "escape" || spec === "n") close()
      else if (spec === "y" || spec === "return") unpinBucket(ov.bucket)
      return
    case "rename":
      if (spec === "escape") close()
      return
    case "collision": {
      const choices = ["overwrite", "skip", "cancel"] as const
      if (spec === "j" || spec === "down") setOverlay({ ...ov, cursor: Math.min(ov.cursor + 1, 2) })
      else if (spec === "k" || spec === "up") setOverlay({ ...ov, cursor: Math.max(ov.cursor - 1, 0) })
      else if (spec === "return") resolveCollision(ov.jobId, choices[ov.cursor] ?? "cancel")
      else if (spec === "escape") resolveCollision(ov.jobId, "cancel")
      return
    }
    case "transfers": {
      if (spec === "escape" || spec === "q" || spec === "t") close()
      else if (spec === "x") {
        const running = useApp.getState().jobs.find((j) => j.status === "running" || j.status === "expanding")
        if (running) abortJob(running.id)
      } else if (spec === "C") clearFinishedJobs()
      return
    }
    case "quit-confirm":
      if (spec === "y" || spec === "return") exit()
      else if (spec === "escape" || spec === "n") close()
      return
    case "error":
      if (spec === "r" && ov.retry) {
        close()
        ov.retry()
      } else if (spec === "escape" || spec === "q" || spec === "return") close()
      return
  }
}
