import type { KeyEvent } from "@opentui/core"

export type ActionId =
  | "cursor-down" | "cursor-up" | "cursor-top" | "cursor-bottom" | "page-down" | "page-up"
  | "switch-pane" | "open" | "up"
  | "select" | "filter" | "sort" | "sort-reverse"
  | "copy-uri" | "presign"
  | "copy" | "move" | "delete" | "rename"
  | "refresh" | "load-more"
  | "preview" | "metadata"
  | "profile" | "pin-bucket" | "toggle-local"
  | "transfers" | "help" | "quit" | "escape"

export interface Binding {
  /** normalized key specs, see keySpec() */
  keys: string[]
  /** shown in the help overlay */
  display: string
  help: string
  action: ActionId
  group: "Navigate" | "View" | "Actions" | "App"
}

export const KEYMAP: Binding[] = [
  { keys: ["j", "down"], display: "j/↓", help: "cursor down", action: "cursor-down", group: "Navigate" },
  { keys: ["k", "up"], display: "k/↑", help: "cursor up", action: "cursor-up", group: "Navigate" },
  { keys: ["g", "home"], display: "g", help: "jump to top", action: "cursor-top", group: "Navigate" },
  { keys: ["G", "end"], display: "G", help: "jump to bottom", action: "cursor-bottom", group: "Navigate" },
  { keys: ["pagedown", "C-d"], display: "PgDn", help: "page down", action: "page-down", group: "Navigate" },
  { keys: ["pageup", "C-u"], display: "PgUp", help: "page up", action: "page-up", group: "Navigate" },
  { keys: ["tab"], display: "Tab", help: "switch pane", action: "switch-pane", group: "Navigate" },
  { keys: ["return", "l", "right"], display: "Enter/l", help: "open bucket/dir · file info", action: "open", group: "Navigate" },
  { keys: ["backspace", "h", "left"], display: "Bksp/h", help: "up one level", action: "up", group: "Navigate" },
  { keys: ["space"], display: "Space", help: "select item", action: "select", group: "Navigate" },

  { keys: ["/"], display: "/", help: "filter listing", action: "filter", group: "View" },
  { keys: ["s"], display: "s", help: "sort: name → size → date", action: "sort", group: "View" },
  { keys: ["S"], display: "S", help: "reverse sort order", action: "sort-reverse", group: "View" },
  { keys: ["R", "f2"], display: "R", help: "refresh (bypass cache)", action: "refresh", group: "View" },
  { keys: ["L"], display: "L", help: "load more (truncated listing)", action: "load-more", group: "View" },
  { keys: ["v", "f3"], display: "v", help: "preview text object", action: "preview", group: "View" },
  { keys: ["i"], display: "i", help: "object metadata", action: "metadata", group: "View" },

  { keys: ["y"], display: "y", help: "copy s3:// URI / path", action: "copy-uri", group: "Actions" },
  { keys: ["Y"], display: "Y", help: "copy presigned URL", action: "presign", group: "Actions" },
  { keys: ["c", "f5"], display: "c/F5", help: "copy to other pane", action: "copy", group: "Actions" },
  { keys: ["m", "f6"], display: "m/F6", help: "move to other pane", action: "move", group: "Actions" },
  { keys: ["d", "f8", "delete"], display: "d/F8", help: "delete (unpin on pinned bucket)", action: "delete", group: "Actions" },
  { keys: ["r"], display: "r", help: "rename", action: "rename", group: "Actions" },

  { keys: ["p"], display: "p", help: "switch AWS profile", action: "profile", group: "App" },
  { keys: ["b"], display: "b", help: "open/pin bucket by name", action: "pin-bucket", group: "App" },
  { keys: ["`"], display: "`", help: "toggle pane: S3 ↔ local", action: "toggle-local", group: "App" },
  { keys: ["t"], display: "t", help: "transfer queue", action: "transfers", group: "App" },
  { keys: ["?"], display: "?", help: "help", action: "help", group: "App" },
  { keys: ["q", "C-c"], display: "q", help: "quit", action: "quit", group: "App" },
  { keys: ["escape"], display: "Esc", help: "close / clear filter", action: "escape", group: "App" },
]

/** Normalize a key event to a spec like "j", "G", "C-c", "f5", "space". */
export function keySpec(key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "sequence">): string {
  let name = key.name || key.sequence || ""
  const seq = key.sequence
  // prefer the produced character for shifted punctuation (shift+/ → "?", shift+` → "~")
  if (!key.ctrl && !key.meta && seq && seq.length === 1) {
    const code = seq.charCodeAt(0)
    if (code >= 0x21 && code <= 0x7e && !/[a-zA-Z]/.test(seq)) name = seq
  }
  if (name === " ") name = "space"
  if (name.length === 1 && /[a-z]/i.test(name)) {
    name = key.shift ? name.toUpperCase() : name.toLowerCase()
  }
  let spec = name
  if (key.ctrl) spec = "C-" + spec
  if (key.meta) spec = "M-" + spec
  return spec
}

const bySpec = new Map<string, Binding>()
for (const b of KEYMAP) {
  for (const k of b.keys) bySpec.set(k, b)
}

export function lookupAction(key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "sequence">): ActionId | null {
  return bySpec.get(keySpec(key))?.action ?? null
}
