import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as path from "node:path"
import { classifyError } from "../aws/errors.ts"
import * as s3 from "../aws/s3.ts"
import { ensureDirFor, exists, removeRecursive, walkDir } from "../fs/local.ts"
import { humanBytes } from "./format.ts"
import { locationTitle, sameLocation } from "./keys.ts"
import {
  clearSelection,
  otherSide,
  refreshLocation,
  selectionOrCursor,
  setOverlay,
  toast,
  useApp,
} from "./store.ts"
import type { Entry, Location, PaneSide, TransferJob, TransferTask } from "./types.ts"

const CONCURRENCY = 4
const FLUSH_MS = 100

let jobSeq = 0
let taskSeq = 0

interface JobRuntime {
  abort: AbortController
  items: Entry[]
  srcLoc: Location
  collisionResolve: ((choice: "overwrite" | "skip" | "cancel") => void) | null
}
const runtimes = new Map<number, JobRuntime>()

function getJob(id: number): TransferJob | undefined {
  return useApp.getState().jobs.find((j) => j.id === id)
}

/** Replace the job object in the store (tasks are shared mutable refs). */
function flushJob(job: TransferJob): void {
  job.bytesDone = job.tasks.reduce((a, t) => a + t.bytesDone, 0)
  useApp.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === job.id ? { ...job } : j)) }))
}

export function abortJob(id: number): void {
  runtimes.get(id)?.abort.abort()
  runtimes.get(id)?.collisionResolve?.("cancel")
}

export function clearFinishedJobs(): void {
  useApp.setState((s) => ({
    jobs: s.jobs.filter((j) => j.status === "running" || j.status === "expanding" || j.status === "collision"),
  }))
}

// ---------------------------------------------------------------------------

export async function startTransfer(kind: "copy" | "move"): Promise<void> {
  const st = useApp.getState()
  const srcSide = st.active
  const dstSide = otherSide(srcSide)
  const srcLoc = st.panes[srcSide].location
  const dstLoc = st.panes[dstSide].location
  if (srcLoc.type === "s3-buckets") {
    toast("Enter a bucket first — whole buckets can't be copied", "info")
    return
  }
  if (dstLoc.type === "s3-buckets") {
    toast("Other pane must show a bucket/prefix or a local directory", "info")
    return
  }
  if (sameLocation(srcLoc, dstLoc)) {
    toast("Both panes show the same location", "info")
    return
  }
  const items = selectionOrCursor(srcSide)
  if (items.length === 0) return

  // refuse copying a dir into itself
  for (const item of items.filter((i) => i.kind === "dir")) {
    if (srcLoc.type === "local" && dstLoc.type === "local" && (dstLoc.dir + path.sep).startsWith(item.key + path.sep)) {
      toast(`Cannot copy ${item.name} into itself`, "error")
      return
    }
    if (srcLoc.type === "s3" && dstLoc.type === "s3" && srcLoc.bucket === dstLoc.bucket && dstLoc.prefix.startsWith(item.key)) {
      toast(`Cannot copy ${item.name} into itself`, "error")
      return
    }
  }

  const dstNames = new Set(st.panes[dstSide].entries.filter((e) => e.kind === "file").map((e) => e.name))
  await runJob(kind, srcSide, items, srcLoc, dstLoc, null, dstNames)
  clearSelection(srcSide)
}

export async function renameEntry(side: PaneSide, entry: Entry, newName: string): Promise<void> {
  const st = useApp.getState()
  const loc = st.panes[side].location
  if (loc.type === "s3-buckets") return

  if (loc.type === "local") {
    const dst = path.join(loc.dir, newName)
    try {
      if (await exists(dst)) throw new Error(`${newName} already exists`)
      await fsp.rename(entry.key, dst)
      setOverlay(null)
      refreshLocation(loc)
      toast(`Renamed to ${newName}`, "success")
    } catch (err) {
      rethrowToOverlay(err)
    }
    return
  }

  // S3 file: fast path (copy + delete)
  if (entry.kind === "file") {
    try {
      const dstKey = loc.prefix + newName
      await s3.copyObject(loc.profile, loc.bucket, entry.key, loc.bucket, dstKey)
      await s3.deleteObject(loc.profile, loc.bucket, entry.key)
      setOverlay(null)
      refreshLocation(loc)
      toast(`Renamed to ${newName}`, "success")
    } catch (err) {
      rethrowToOverlay(err)
    }
    return
  }

  // S3 prefix rename: full copy+delete job
  setOverlay(null)
  await runJob("rename", side, [entry], loc, loc, newName, new Set())
}

function rethrowToOverlay(err: unknown): void {
  const cur = useApp.getState().overlay
  const msg = err instanceof Error && !("$metadata" in err) ? err.message : classifyError(err).message
  if (cur?.kind === "rename") setOverlay({ ...cur, error: msg })
  else toast(msg, "error")
}

// ---------------------------------------------------------------------------

async function runJob(
  kind: TransferJob["kind"],
  srcSide: PaneSide,
  items: Entry[],
  srcLoc: Location,
  dstLoc: Location,
  renameTo: string | null,
  dstFileNames: Set<string>,
): Promise<void> {
  const abort = new AbortController()
  const label =
    kind === "rename"
      ? `rename ${items[0]?.name} → ${renameTo}`
      : `${items.length === 1 ? items[0]?.name : `${items.length} items`} → ${locationTitle(dstLoc)}`
  const job: TransferJob = {
    id: ++jobSeq,
    kind,
    label,
    status: "expanding",
    tasks: [],
    filesDone: 0,
    bytesDone: 0,
    bytesTotal: 0,
    error: undefined,
  }
  runtimes.set(job.id, { abort, items, srcLoc, collisionResolve: null })
  useApp.setState((s) => ({ jobs: [...s.jobs, job] }))

  try {
    job.tasks = await expandItems(items, srcLoc, dstLoc, renameTo, abort.signal)
  } catch (err) {
    const c = classifyError(err)
    job.status = c.kind === "aborted" ? "aborted" : "error"
    job.error = c.message
    flushJob(job)
    runtimes.delete(job.id)
    if (c.kind !== "aborted") toast(`Transfer failed: ${c.message}`, "error")
    return
  }

  if (job.tasks.length === 0) {
    job.status = "done"
    flushJob(job)
    runtimes.delete(job.id)
    toast("Nothing to transfer", "info")
    return
  }

  // top-level file collisions against the destination pane's listing
  const collisions = [...new Set(job.tasks.filter((t) => !t.topIsDir && dstFileNames.has(t.topName)).map((t) => t.topName))]
  if (collisions.length > 0) {
    job.status = "collision"
    flushJob(job)
    const choice = await new Promise<"overwrite" | "skip" | "cancel">((resolve) => {
      const rt = runtimes.get(job.id)
      if (rt) rt.collisionResolve = resolve
      setOverlay({ kind: "collision", jobId: job.id, names: collisions, cursor: 0 })
    })
    setOverlay(null)
    const rt = runtimes.get(job.id)
    if (rt) rt.collisionResolve = null
    if (choice === "cancel") {
      job.status = "aborted"
      flushJob(job)
      runtimes.delete(job.id)
      return
    }
    if (choice === "skip") {
      const skipNames = new Set(collisions)
      for (const t of job.tasks) {
        if (!t.topIsDir && skipNames.has(t.topName)) t.status = "skipped"
      }
    }
  }

  job.status = "running"
  job.bytesTotal = job.tasks.filter((t) => t.status !== "skipped").reduce((a, t) => a + t.size, 0)
  flushJob(job)

  const flusher = setInterval(() => flushJob(job), FLUSH_MS)
  const queue = job.tasks.filter((t) => t.status === "pending")
  let next = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const task = queue[next++]
      if (!task || abort.signal.aborted) return
      task.status = "active"
      try {
        await runTask(task, abort.signal)
        task.bytesDone = task.size
        task.status = "done"
        job.filesDone++
        if (kind !== "copy") await deleteSource(task)
      } catch (err) {
        const c = classifyError(err)
        if (c.kind === "aborted") {
          task.status = "skipped"
        } else {
          task.status = "error"
          task.error = c.message
        }
      }
    }
  })
  await Promise.all(workers)
  clearInterval(flusher)

  const failed = job.tasks.filter((t) => t.status === "error")
  if (abort.signal.aborted) {
    job.status = "aborted"
  } else if (failed.length > 0) {
    job.status = "error"
    job.error = `${failed.length}/${job.tasks.length} failed — first: ${failed[0]?.label}: ${failed[0]?.error}`
  } else {
    job.status = "done"
    // move/rename: clean up now-empty local source dirs (s3 "dirs" disappear with their objects)
    if (kind !== "copy" && srcLoc.type === "local") {
      for (const item of items.filter((i) => i.kind === "dir")) {
        await removeRecursive(item.key).catch(() => {})
      }
    }
  }
  flushJob(job)
  runtimes.delete(job.id)

  refreshLocation(srcLoc)
  refreshLocation(dstLoc)
  const verb = kind === "copy" ? "Copied" : kind === "move" ? "Moved" : "Renamed"
  if (job.status === "done") {
    toast(`${verb} ${job.filesDone} file(s), ${humanBytes(job.bytesTotal)}`, "success")
  } else if (job.status === "error") {
    toast(job.error ?? "Transfer failed", "error")
  }
}

export function resolveCollision(jobId: number, choice: "overwrite" | "skip" | "cancel"): void {
  runtimes.get(jobId)?.collisionResolve?.(choice)
}

// ---------------------------------------------------------------------------
// expansion

async function expandItems(
  items: Entry[],
  srcLoc: Location,
  dstLoc: Location,
  renameTo: string | null,
  signal: AbortSignal,
): Promise<TransferTask[]> {
  const tasks: TransferTask[] = []
  const mkDst = (topName: string, rel: string | null): TransferTask["dst"] => {
    if (dstLoc.type === "s3") {
      const key = rel === null ? dstLoc.prefix + topName : dstLoc.prefix + topName + "/" + rel
      return { loc: "s3", profile: dstLoc.profile, bucket: dstLoc.bucket, key }
    }
    if (dstLoc.type === "local") {
      const parts = rel === null ? [topName] : [topName, ...rel.split("/")]
      return { loc: "local", path: path.join(dstLoc.dir, ...parts) }
    }
    throw new Error("Invalid destination")
  }

  for (const item of items) {
    const topName = renameTo ?? item.name
    if (srcLoc.type === "s3") {
      if (item.kind === "file") {
        tasks.push(mkTask(item.name, topName, false, { loc: "s3", profile: srcLoc.profile, bucket: srcLoc.bucket, key: item.key }, mkDst(topName, null), item.size ?? 0))
      } else {
        for await (const page of s3.walkPrefix(srcLoc.profile, srcLoc.bucket, item.key, signal)) {
          for (const o of page) {
            const rel = o.key.slice(item.key.length)
            if (rel === "" && dstLoc.type === "local") continue // skip folder-marker for local dst
            const dst = rel === "" ? mkDirMarkerDst(dstLoc, topName) : mkDst(topName, rel)
            tasks.push(mkTask(rel || topName + "/", topName, true, { loc: "s3", profile: srcLoc.profile, bucket: srcLoc.bucket, key: o.key }, dst, o.size))
          }
        }
      }
    } else if (srcLoc.type === "local") {
      if (item.kind === "file") {
        tasks.push(mkTask(item.name, topName, false, { loc: "local", path: item.key }, mkDst(topName, null), item.size ?? 0))
      } else {
        const files = await walkDir(item.key, signal)
        for (const f of files) {
          tasks.push(mkTask(f.rel, topName, true, { loc: "local", path: f.abs }, mkDst(topName, f.rel), f.size))
        }
      }
    }
  }
  return tasks
}

function mkDirMarkerDst(dstLoc: Location, topName: string): TransferTask["dst"] {
  if (dstLoc.type !== "s3") throw new Error("marker only for s3 destinations")
  return { loc: "s3", profile: dstLoc.profile, bucket: dstLoc.bucket, key: dstLoc.prefix + topName + "/" }
}

function mkTask(
  label: string,
  topName: string,
  topIsDir: boolean,
  src: TransferTask["src"],
  dst: TransferTask["dst"],
  size: number,
): TransferTask {
  return { id: ++taskSeq, label, topName, topIsDir, src, dst, size, bytesDone: 0, status: "pending" }
}

// ---------------------------------------------------------------------------
// task strategies

async function runTask(t: TransferTask, signal: AbortSignal): Promise<void> {
  if (t.src.loc === "s3" && t.dst.loc === "s3") {
    if (t.src.bucket === t.dst.bucket && t.src.key === t.dst.key) {
      throw new Error("source and destination are the same object")
    }
    if (t.size > s3.COPY_OBJECT_LIMIT) {
      throw new Error(`exceeds the 5 GiB single-request copy limit (${humanBytes(t.size)}) — download then upload instead`)
    }
    await s3.copyObject(t.dst.profile, t.src.bucket, t.src.key, t.dst.bucket, t.dst.key, signal)
    return
  }
  if (t.src.loc === "s3" && t.dst.loc === "local") {
    await downloadTask(t, signal)
    return
  }
  if (t.src.loc === "local" && t.dst.loc === "s3") {
    await s3.uploadStream(t.dst.profile, t.dst.bucket, t.dst.key, fs.createReadStream(t.src.path), signal, (loaded) => {
      t.bytesDone = Math.min(loaded, t.size)
    })
    return
  }
  if (t.src.loc === "local" && t.dst.loc === "local") {
    await ensureDirFor(t.dst.path)
    await fsp.copyFile(t.src.path, t.dst.path)
    return
  }
}

async function downloadTask(t: TransferTask, signal: AbortSignal): Promise<void> {
  if (t.src.loc !== "s3" || t.dst.loc !== "local") throw new Error("bad task routing")
  if (t.dst.path.endsWith(path.sep)) return
  const out = await s3.getObjectBody(t.src.profile, t.src.bucket, t.src.key, signal)
  await ensureDirFor(t.dst.path)
  const writer = Bun.file(t.dst.path).writer()
  try {
    const body = out.Body as { transformToWebStream?: () => ReadableStream<Uint8Array> }
    const stream =
      typeof body.transformToWebStream === "function"
        ? body.transformToWebStream()
        : (out.Body as unknown as AsyncIterable<Uint8Array>)
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      writer.write(chunk)
      t.bytesDone += chunk.length
    }
    await writer.end()
  } catch (err) {
    try {
      await writer.end()
    } catch {
      // writer already closed
    }
    await fsp.rm(t.dst.path, { force: true }).catch(() => {})
    throw err
  }
}

async function deleteSource(t: TransferTask): Promise<void> {
  if (t.src.loc === "s3") await s3.deleteObject(t.src.profile, t.src.bucket, t.src.key)
  else await fsp.rm(t.src.path, { force: true })
}
