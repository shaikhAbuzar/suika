import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Entry } from "../core/types.ts"

export async function listDir(dir: string, showHidden: boolean): Promise<Entry[]> {
  const names = await fs.readdir(dir)
  const visible = showHidden ? names : names.filter((n) => !n.startsWith("."))
  const entries = await Promise.all(
    visible.map(async (name): Promise<Entry> => {
      const abs = path.join(dir, name)
      try {
        const lst = await fs.lstat(abs)
        if (lst.isSymbolicLink()) {
          let isDir = false
          try {
            isDir = (await fs.stat(abs)).isDirectory()
          } catch {
            // broken symlink — show as file
          }
          return { name, kind: isDir ? "dir" : "file", key: abs, mtime: lst.mtime, note: "→" }
        }
        return lst.isDirectory()
          ? { name, kind: "dir", key: abs, mtime: lst.mtime }
          : { name, kind: "file", key: abs, size: lst.size, mtime: lst.mtime }
      } catch (err) {
        return { name, kind: "file", key: abs, note: (err as { code?: string }).code ?? "?" }
      }
    }),
  )
  return entries
}

export interface WalkedFile {
  /** absolute path */
  abs: string
  /** path relative to the walk root, using "/" separators */
  rel: string
  size: number
}

/** All regular files under a directory (follows nothing; skips symlinks). */
export async function walkDir(root: string, signal?: AbortSignal): Promise<WalkedFile[]> {
  const out: WalkedFile[] = []
  async function recurse(dir: string, relBase: string): Promise<void> {
    if (signal?.aborted) throw abortError()
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    for (const d of dirents) {
      const abs = path.join(dir, d.name)
      const rel = relBase ? `${relBase}/${d.name}` : d.name
      if (d.isSymbolicLink()) continue
      if (d.isDirectory()) await recurse(abs, rel)
      else if (d.isFile()) {
        const st = await fs.stat(abs)
        out.push({ abs, rel, size: st.size })
      }
    }
  }
  await recurse(root, "")
  return out
}

export async function ensureDirFor(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

export async function removeRecursive(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true })
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function abortError(): Error {
  const e = new Error("Aborted")
  e.name = "AbortError"
  return e
}
