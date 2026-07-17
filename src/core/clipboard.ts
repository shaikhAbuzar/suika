/** Copy text to the system clipboard: pbcopy on macOS, OSC 52 elsewhere/fallback. */
export async function copyToClipboard(text: string): Promise<void> {
  if (process.platform === "darwin") {
    try {
      const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
      proc.stdin.write(text)
      await proc.stdin.end()
      if ((await proc.exited) === 0) return
    } catch {
      // fall through to OSC 52
    }
  }
  // OSC 52: supported by iTerm2, kitty, WezTerm, tmux (with set-clipboard on)
  const b64 = Buffer.from(text, "utf8").toString("base64")
  process.stdout.write(`\x1b]52;c;${b64}\x07`)
}
