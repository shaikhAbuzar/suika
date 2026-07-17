import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./App.tsx"

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 30,
})

// Safety net for missed SIGWINCH/resize events (some terminals/multiplexers
// drop them): if the tty's real size drifts from the renderer's, force a resize.
setInterval(() => {
  const cols = process.stdout.columns
  const rows = process.stdout.rows
  if (process.env.SUIKA_DEBUG_SIZE) {
    require("node:fs").appendFileSync(
      "/tmp/suika-size.log",
      `stdout=${cols}x${rows} renderer=${renderer.width}x${renderer.height}\n`,
    )
  }
  if (process.env.SUIKA_NO_WATCHDOG) return
  if (cols && rows && (cols !== renderer.width || rows !== renderer.height)) {
    renderer.resize(cols, rows)
  }
}, 1000).unref()

process.on("uncaughtException", (err) => {
  renderer.destroy()
  console.error("suika crashed:", err)
  process.exit(1)
})
process.on("unhandledRejection", (err) => {
  renderer.destroy()
  console.error("suika crashed (unhandled rejection):", err)
  process.exit(1)
})

createRoot(renderer).render(<App />)
