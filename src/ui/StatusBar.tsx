import { profileRegion } from "../aws/clients.ts"
import { humanBytes, padEndTo, progressBar, truncateEnd } from "../core/format.ts"
import { useApp } from "../core/store.ts"
import { theme } from "./theme.ts"

export function StatusBar({ width }: { width: number }) {
  const profile = useApp((s) => s.profile)
  const toast = useApp((s) => s.toast)
  const jobs = useApp((s) => s.jobs)

  const running = jobs.filter((j) => j.status === "running" || j.status === "expanding")
  const left = ` ${profile} @ ${profileRegion(profile)} `

  let middle = ""
  let middleFg = theme.dim
  if (toast) {
    middle = ` ${toast.message} `
    middleFg = toast.variant === "error" ? theme.error : toast.variant === "success" ? theme.success : theme.info
  } else if (running.length > 0) {
    const j = running[0]!
    const bar = progressBar(j.bytesDone, j.bytesTotal, 16)
    middle =
      j.status === "expanding"
        ? ` ${j.label}: listing… `
        : ` ${j.label}  ${bar} ${humanBytes(j.bytesDone)}/${humanBytes(j.bytesTotal)} (${j.filesDone}/${j.tasks.length}) `
    middleFg = theme.info
  }

  // trailing space so clipping in an undersized terminal never eats a letter
  const right = process.env.SUIKA_DEBUG_SIZE ? `[${width}x${process.stdout.rows ?? "?"}] ?:help  q:quit ` : "?:help  q:quit "
  const midW = Math.max(0, width - left.length - right.length)

  // one text renderable with spans: a single row that can never wrap or reflow
  return (
    <box width={width} height={1} backgroundColor={theme.statusBg}>
      <text wrapMode="none" height={1} bg={theme.statusBg}>
        <span fg={theme.titleActive}>{truncateEnd(left, width)}</span>
        <span fg={middleFg}>{padEndTo(truncateEnd(middle, midW), midW)}</span>
        <span fg={theme.dim}>{right}</span>
      </text>
    </box>
  )
}
