export type PaneSide = "left" | "right"
export type SortMode = "name" | "size" | "mtime"

export type Location =
  | { type: "s3-buckets"; profile: string }
  | { type: "s3"; profile: string; bucket: string; prefix: string } // prefix is "" or ends with "/"
  | { type: "local"; dir: string } // absolute path, no trailing slash (except root)

export type EntryKind = "bucket" | "dir" | "file" | "action"
export type AccessState = "unknown" | "checking" | "ok" | "denied"

export interface Entry {
  /** Display leaf name (no trailing slash) */
  name: string
  kind: EntryKind
  /** Full S3 key (dirs end with "/"), absolute local path, or bucket name */
  key: string
  size?: number
  mtime?: Date
  storageClass?: string
  pinned?: boolean
  access?: AccessState
  note?: string
}

export interface PaneState {
  location: Location
  entries: Entry[]
  loading: boolean
  error: string | null
  errorHint: string | null
  /** true when listing stopped at the soft cap and more pages exist */
  truncated: boolean
  nextToken: string | null
  cursor: number
  scroll: number
  filter: string
  filterEditing: boolean
  sort: SortMode
  sortReverse: boolean
  selected: Set<string>
  /** bumped on every navigation/refresh; async results from older generations are dropped */
  gen: number
}

export type TaskStatus = "pending" | "active" | "done" | "error" | "skipped"

export interface TransferTask {
  id: number
  /** short human label, e.g. the relative key */
  label: string
  src: { loc: "s3"; profile: string; bucket: string; key: string } | { loc: "local"; path: string }
  dst: { loc: "s3"; profile: string; bucket: string; key: string } | { loc: "local"; path: string }
  size: number
  bytesDone: number
  status: TaskStatus
  error?: string
  /** top-level entry name this task belongs to (collision handling) */
  topName: string
  topIsDir: boolean
}

export type JobStatus = "expanding" | "collision" | "running" | "done" | "error" | "aborted"

export interface TransferJob {
  id: number
  kind: "copy" | "move" | "rename"
  label: string
  status: JobStatus
  tasks: TransferTask[]
  filesDone: number
  bytesDone: number
  bytesTotal: number
  error?: string
}

export interface ProfileInfo {
  name: string
  region: string
  isSSO: boolean
}

export type Overlay =
  | { kind: "help" }
  | { kind: "profile"; cursor: number }
  | { kind: "pin-bucket"; side: PaneSide }
  | { kind: "metadata"; title: string; rows: Array<[string, string]>; loading: boolean }
  | {
      kind: "preview"
      title: string
      content: string
      filetype: string | null
      loading: boolean
      error: string | null
    }
  | {
      kind: "confirm-delete"
      side: PaneSide
      items: Entry[]
      /** null while counting; set once expansion finished */
      expanded: { count: number; bytes: number } | null
      /** exact string user must type; null → simple y/enter confirm */
      needTyped: string | null
      typed: string
      busy: boolean
      error: string | null
    }
  | { kind: "unpin-bucket"; side: PaneSide; bucket: string }
  | { kind: "rename"; side: PaneSide; entry: Entry; error: string | null }
  | { kind: "collision"; jobId: number; names: string[]; cursor: number }
  | { kind: "transfers"; cursor: number }
  | { kind: "quit-confirm" }
  | { kind: "error"; title: string; message: string; hint: string | null; retry: (() => void) | null }

export interface Toast {
  message: string
  variant: "info" | "error" | "success"
  at: number
}
