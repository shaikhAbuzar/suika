import { useTerminalDimensions } from "@opentui/react"
import { humanBytes, progressBar } from "../../core/format.ts"
import { confirmDelete, pinBucket, setOverlay, unpinBucket, useApp } from "../../core/store.ts"
import { renameEntry, resolveCollision } from "../../core/transfers.ts"
import type { Overlay } from "../../core/types.ts"
import { KEYMAP } from "../../keymap.ts"
import { Modal } from "../Modal.tsx"
import { theme } from "../theme.ts"

export function OverlayHost() {
  const overlay = useApp((s) => s.overlay)
  if (!overlay) return null
  switch (overlay.kind) {
    case "help":
      return <HelpOverlay />
    case "profile":
      return <ProfileOverlay overlay={overlay} />
    case "pin-bucket":
      return <PinBucketOverlay overlay={overlay} />
    case "metadata":
      return <MetadataOverlay overlay={overlay} />
    case "preview":
      return <PreviewOverlay overlay={overlay} />
    case "confirm-delete":
      return <ConfirmDeleteOverlay overlay={overlay} />
    case "unpin-bucket":
      return <UnpinOverlay overlay={overlay} />
    case "rename":
      return <RenameOverlay overlay={overlay} />
    case "collision":
      return <CollisionOverlay overlay={overlay} />
    case "transfers":
      return <TransfersOverlay />
    case "quit-confirm":
      return <QuitOverlay />
    case "error":
      return <ErrorOverlay overlay={overlay} />
  }
}

function HelpOverlay() {
  const dims = useTerminalDimensions()
  const groups = ["Navigate", "View", "Actions", "App"] as const
  return (
    <Modal title="suika — keys" width={64} height={Math.min(30, dims.height - 2)}>
      <scrollbox focused style={{ flexGrow: 1 }}>
        {groups.map((g) => (
          <box key={g} flexDirection="column" marginBottom={1}>
            <text fg={theme.titleActive}>{g}</text>
            {KEYMAP.filter((b) => b.group === g).map((b) => (
              <text key={b.action} fg={theme.text}>
                {`  ${b.display.padEnd(10)} ${b.help}`}
              </text>
            ))}
          </box>
        ))}
      </scrollbox>
      <text fg={theme.dim}>Esc to close</text>
    </Modal>
  )
}

function ProfileOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "profile" }> }) {
  const profiles = useApp((s) => s.profiles)
  const current = useApp((s) => s.profile)
  return (
    <Modal title="Switch AWS profile" width={50}>
      {profiles.map((p, i) => (
        <text
          key={p.name}
          fg={p.name === current ? theme.success : theme.text}
          bg={i === overlay.cursor ? theme.cursorBg : undefined}
        >
          {` ${p.name === current ? "●" : " "} ${p.name.padEnd(24)} ${p.region}${p.isSSO ? "  (sso)" : ""} `}
        </text>
      ))}
      <text fg={theme.dim}>{""}</text>
      <text fg={theme.dim}>Enter: switch · Esc: cancel</text>
    </Modal>
  )
}

function PinBucketOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "pin-bucket" }> }) {
  const profile = useApp((s) => s.profile)
  return (
    <Modal title={`Open / pin bucket (${profile})`} width={56} height={7}>
      <text fg={theme.dim}>Bucket name (also saved to pinned buckets):</text>
      <box height={1} backgroundColor={theme.inputBg}>
        <input
          focused
          placeholder="my-bucket-name"
          onSubmit={(v: unknown) => {
            if (typeof v === "string") pinBucket(overlay.side, v)
          }}
        />
      </box>
      <text fg={theme.dim}>Enter: open+pin · Esc: cancel</text>
    </Modal>
  )
}

function MetadataOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "metadata" }> }) {
  const keyW = overlay.rows.reduce((a, [k]) => Math.max(a, k.length), 0)
  return (
    <Modal title="Object metadata" width={72}>
      <text fg={theme.dir}>{overlay.title}</text>
      <text>{""}</text>
      {overlay.loading ? (
        <text fg={theme.dim}>loading…</text>
      ) : (
        overlay.rows.map(([k, v]) => (
          <text key={k} fg={theme.text}>
            <span fg={theme.dim}>{`${k.padEnd(keyW)}  `}</span>
            {v}
          </text>
        ))
      )}
      <text>{""}</text>
      <text fg={theme.dim}>Esc to close</text>
    </Modal>
  )
}

function PreviewOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "preview" }> }) {
  const dims = useTerminalDimensions()
  return (
    <Modal title={overlay.title} width={dims.width - 8} height={dims.height - 4}>
      {overlay.loading ? (
        <text fg={theme.dim}>loading…</text>
      ) : overlay.error ? (
        <text fg={theme.error}>{overlay.error}</text>
      ) : (
        <scrollbox focused style={{ flexGrow: 1 }}>
          <text fg={theme.text}>{overlay.content || "(empty file)"}</text>
        </scrollbox>
      )}
      <text fg={theme.dim}>Esc to close · arrows/PgUp/PgDn scroll</text>
    </Modal>
  )
}

function ConfirmDeleteOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "confirm-delete" }> }) {
  const names = overlay.items
    .slice(0, 5)
    .map((i) => (i.kind === "dir" ? i.name + "/" : i.name))
    .join(", ")
  const more = overlay.items.length > 5 ? ` +${overlay.items.length - 5} more` : ""
  return (
    <Modal title="Delete" width={64}>
      <text fg={theme.error}>{`Delete: ${names}${more}`}</text>
      <text fg={theme.dim}>
        {overlay.expanded
          ? `${overlay.expanded.count} object(s), ${humanBytes(overlay.expanded.bytes)}`
          : "counting objects…"}
      </text>
      <text>{""}</text>
      {overlay.needTyped ? (
        <>
          <text fg={theme.text}>{`Type "${overlay.needTyped}" to confirm:`}</text>
          <box height={1} backgroundColor={theme.inputBg}>
            <input focused onInput={(v: string) => setOverlay({ ...overlay, typed: v })} onSubmit={() => void confirmDelete()} />
          </box>
        </>
      ) : (
        <text fg={theme.text}>Press y or Enter to confirm</text>
      )}
      {overlay.error ? <text fg={theme.error}>{overlay.error}</text> : null}
      <text fg={theme.dim}>{overlay.busy ? "deleting…" : "Esc: cancel"}</text>
    </Modal>
  )
}

function UnpinOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "unpin-bucket" }> }) {
  return (
    <Modal title="Unpin bucket" width={56}>
      <text fg={theme.text}>{`Remove "${overlay.bucket}" from pinned buckets?`}</text>
      <text fg={theme.dim}>The bucket itself is not touched.</text>
      <text>{""}</text>
      <text fg={theme.dim}>y/Enter: unpin · Esc: cancel</text>
    </Modal>
  )
}

function RenameOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "rename" }> }) {
  return (
    <Modal title="Rename" width={64} height={8}>
      <text fg={theme.dim}>{overlay.entry.kind === "dir" ? `${overlay.entry.name}/ →` : `${overlay.entry.name} →`}</text>
      <box height={1} backgroundColor={theme.inputBg}>
        <input
          focused
          value={overlay.entry.name}
          onSubmit={(v: unknown) => {
            if (typeof v !== "string") return
            const name = v.trim()
            if (!name || name === overlay.entry.name) return setOverlay(null)
            if (name.includes("/")) return setOverlay({ ...overlay, error: "Name cannot contain /" })
            void renameEntry(overlay.side, overlay.entry, name)
          }}
        />
      </box>
      {overlay.error ? <text fg={theme.error}>{overlay.error}</text> : null}
      <text fg={theme.dim}>Enter: rename · Esc: cancel</text>
    </Modal>
  )
}

function CollisionOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "collision" }> }) {
  const options: Array<["overwrite" | "skip" | "cancel", string]> = [
    ["overwrite", "Overwrite existing files"],
    ["skip", "Skip existing files"],
    ["cancel", "Cancel transfer"],
  ]
  const names = overlay.names.slice(0, 4).join(", ") + (overlay.names.length > 4 ? ` +${overlay.names.length - 4} more` : "")
  return (
    <Modal title="Files already exist" width={60}>
      <text fg={theme.text}>{names}</text>
      <text>{""}</text>
      {options.map(([choice, label], i) => (
        <text key={choice} fg={theme.text} bg={i === overlay.cursor ? theme.cursorBg : undefined}>
          {` ${label} `}
        </text>
      ))}
      <text>{""}</text>
      <text fg={theme.dim}>Enter: choose · Esc: cancel</text>
    </Modal>
  )
}

function TransfersOverlay() {
  const jobs = useApp((s) => s.jobs)
  return (
    <Modal title="Transfers" width={74}>
      {jobs.length === 0 ? (
        <text fg={theme.dim}>No transfers this session.</text>
      ) : (
        jobs
          .slice(-12)
          .reverse()
          .map((j) => {
            const bar = progressBar(j.bytesDone, j.bytesTotal, 20)
            const status =
              j.status === "running"
                ? `${bar} ${humanBytes(j.bytesDone)}/${humanBytes(j.bytesTotal)}`
                : j.status
            const fg =
              j.status === "error" ? theme.error : j.status === "done" ? theme.success : theme.info
            return (
              <box key={j.id} flexDirection="column">
                <text fg={theme.text}>{`${j.kind}: ${j.label}`}</text>
                <text fg={fg}>{`  ${status}${j.error ? ` — ${j.error}` : ""}`}</text>
              </box>
            )
          })
      )}
      <text>{""}</text>
      <text fg={theme.dim}>x: abort running · C: clear finished · Esc: close</text>
    </Modal>
  )
}

function QuitOverlay() {
  return (
    <Modal title="Quit?" width={50}>
      <text fg={theme.text}>Transfers are still running.</text>
      <text>{""}</text>
      <text fg={theme.dim}>y/Enter: quit anyway · Esc: keep working</text>
    </Modal>
  )
}

function ErrorOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "error" }> }) {
  return (
    <Modal title={overlay.title} width={64}>
      <text fg={theme.error}>{overlay.message}</text>
      {overlay.hint ? <text fg={theme.dim}>{overlay.hint}</text> : null}
      <text>{""}</text>
      <text fg={theme.dim}>{overlay.retry ? "r: retry · " : ""}Esc: close</text>
    </Modal>
  )
}

export { resolveCollision, unpinBucket }
