const UNITS = ["B", "K", "M", "G", "T", "P"]

export function humanBytes(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return ""
  if (n < 1024) return `${n}B`
  let v = n
  let u = 0
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024
    u++
  }
  return v >= 100 ? `${Math.round(v)}${UNITS[u]}` : `${v.toFixed(1)}${UNITS[u]}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function humanDate(d: Date | undefined, now: Date = new Date()): string {
  if (!d) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  if (d.getFullYear() === now.getFullYear()) {
    return `${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${MONTHS[d.getMonth()]} ${pad(d.getDate())}  ${d.getFullYear()}`
}

/** Truncate the middle of a string to fit `width`, keeping start and end. */
export function truncateMiddle(s: string, width: number): string {
  if (width <= 0) return ""
  if (s.length <= width) return s
  if (width <= 1) return "…"
  const keep = width - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return s.slice(0, head) + "…" + (tail > 0 ? s.slice(-tail) : "")
}

/** Truncate the end of a string to fit `width`. */
export function truncateEnd(s: string, width: number): string {
  if (width <= 0) return ""
  if (s.length <= width) return s
  return width === 1 ? "…" : s.slice(0, width - 1) + "…"
}

export function padEndTo(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length)
}

export function padStartTo(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : " ".repeat(width - s.length) + s
}

export function progressBar(done: number, total: number, width: number): string {
  if (width <= 0) return ""
  const ratio = total > 0 ? Math.min(1, done / total) : 0
  const filled = Math.round(ratio * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}
