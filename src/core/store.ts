import { create } from "zustand"
import { classifyError } from "../aws/errors.ts"
import { invalidateProfile, setProfileRegion } from "../aws/clients.ts"
import { listProfiles } from "../aws/profiles.ts"
import * as s3 from "../aws/s3.ts"
import * as local from "../fs/local.ts"
import {
  DEFAULT_CONFIG,
  loadConfig,
  pinnedBucketsFor,
  resolveLocalStartDir,
  saveConfig,
  withPinnedBucket,
  withoutPinnedBucket,
  type SuikaConfig,
} from "../config/config.ts"
import { copyToClipboard } from "./clipboard.ts"
import { childNameFor, leafName, locationKey, locationTitle, parentLocation, s3Uri } from "./keys.ts"
import { clampCursor, indexOfName, moveCursor, nextSort, scrollFor, viewOf } from "./pane-logic.ts"
import type { Entry, Location, Overlay, PaneSide, PaneState, ProfileInfo, Toast, TransferJob } from "./types.ts"

export const LIST_SOFT_CAP = 10_000
const CACHE_TTL_MS = 30_000
const CACHE_MAX = 100
export const PREVIEW_MAX_BYTES = 256 * 1024
export const ADD_BUCKET_KEY = "__suika-add-bucket"

export interface AppState {
  ready: boolean
  fatal: string | null
  config: SuikaConfig
  profiles: ProfileInfo[]
  profile: string
  panes: Record<PaneSide, PaneState>
  active: PaneSide
  overlay: Overlay | null
  jobs: TransferJob[]
  toast: Toast | null
}

function emptyPane(location: Location): PaneState {
  return {
    location,
    entries: [],
    loading: false,
    error: null,
    errorHint: null,
    truncated: false,
    nextToken: null,
    cursor: 0,
    scroll: 0,
    filter: "",
    filterEditing: false,
    sort: "name",
    sortReverse: false,
    selected: new Set(),
    gen: 0,
  }
}

export const useApp = create<AppState>()(() => ({
  ready: false,
  fatal: null,
  config: structuredClone(DEFAULT_CONFIG),
  profiles: [],
  profile: "default",
  panes: {
    left: emptyPane({ type: "s3-buckets", profile: "default" }),
    right: emptyPane({ type: "local", dir: process.cwd() }),
  },
  active: "left",
  overlay: null,
  jobs: [],
  toast: null,
}))

// ---------------------------------------------------------------------------
// module-level (non-reactive) bookkeeping

const aborts: Record<PaneSide, AbortController | null> = { left: null, right: null }
/** name the cursor should land on after the next listing completes */
const landOn: Record<PaneSide, string | null> = { left: null, right: null }

interface CachedListing {
  entries: Entry[]
  truncated: boolean
  nextToken: string | null
  at: number
}
const listingCache = new Map<string, CachedListing>()

/** rows visible in a pane list; kept in sync by the UI for PgUp/PgDn */
export let listHeight = 20
export function setListHeight(h: number): void {
  listHeight = Math.max(1, h)
}

const viewCache: Record<PaneSide, { deps: string; entries: Entry[]; view: Entry[] } | null> = {
  left: null,
  right: null,
}

// ---------------------------------------------------------------------------
// helpers

export function otherSide(side: PaneSide): PaneSide {
  return side === "left" ? "right" : "left"
}

function setPane(side: PaneSide, patch: Partial<PaneState>): void {
  useApp.setState((s) => ({ panes: { ...s.panes, [side]: { ...s.panes[side], ...patch } } }))
}

function pane(side: PaneSide): PaneState {
  return useApp.getState().panes[side]
}

/** Filtered + sorted entries for a pane (memoized per side). */
export function paneView(side: PaneSide): Entry[] {
  const p = pane(side)
  const deps = `${p.gen} ${p.filter} ${p.sort} ${p.sortReverse}`
  const cached = viewCache[side]
  if (cached && cached.deps === deps && cached.entries === p.entries) return cached.view
  const view = viewOf(p.entries, p.filter, p.sort, p.sortReverse)
  viewCache[side] = { deps, entries: p.entries, view }
  return view
}

export function cursorEntry(side: PaneSide): Entry | undefined {
  return paneView(side)[pane(side).cursor]
}

/** Selected entries if any (from the full listing), else the cursor entry. */
export function selectionOrCursor(side: PaneSide): Entry[] {
  const p = pane(side)
  if (p.selected.size > 0) {
    return p.entries.filter((e) => p.selected.has(e.key))
  }
  const e = cursorEntry(side)
  return e ? [e] : []
}

export function toast(message: string, variant: Toast["variant"] = "info"): void {
  const t: Toast = { message, variant, at: Date.now() }
  useApp.setState({ toast: t })
  setTimeout(() => {
    if (useApp.getState().toast === t) useApp.setState({ toast: null })
  }, 5000)
}

export function setOverlay(overlay: Overlay | null): void {
  useApp.setState({ overlay })
}

export function invalidateListing(loc: Location): void {
  listingCache.delete(locationKey(loc))
}

/** Invalidate + reload any visible pane showing this location. */
export function refreshLocation(loc: Location): void {
  invalidateListing(loc)
  for (const side of ["left", "right"] as const) {
    if (locationKey(pane(side).location) === locationKey(loc)) void startListing(side, { force: true })
  }
}

// ---------------------------------------------------------------------------
// startup

export async function initApp(): Promise<void> {
  try {
    const config = loadConfig()
    const profiles = await listProfiles()
    for (const p of profiles) setProfileRegion(p.name, p.region)
    const profile = profiles.some((p) => p.name === config.lastProfile)
      ? config.lastProfile
      : (profiles[0]?.name ?? "default")
    useApp.setState({
      ready: true,
      config,
      profiles,
      profile,
      panes: {
        left: { ...emptyPane({ type: "s3-buckets", profile }), sort: config.ui.sort },
        right: { ...emptyPane({ type: "local", dir: resolveLocalStartDir(config) }), sort: config.ui.sort },
      },
    })
    void startListing("left")
    void startListing("right")
  } catch (err) {
    useApp.setState({ fatal: (err as Error).message })
  }
}

// ---------------------------------------------------------------------------
// listing

export async function startListing(side: PaneSide, opts: { force?: boolean } = {}): Promise<void> {
  const st = useApp.getState()
  const p = st.panes[side]
  const loc = p.location
  aborts[side]?.abort()
  const ac = new AbortController()
  aborts[side] = ac
  const gen = p.gen + 1
  setPane(side, { gen, loading: true, error: null, errorHint: null, truncated: false, nextToken: null })

  const key = locationKey(loc)
  if (!opts.force) {
    const cached = listingCache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      applyEntries(side, gen, cached.entries, cached.truncated, cached.nextToken, false)
      return
    }
  } else {
    listingCache.delete(key)
  }

  try {
    switch (loc.type) {
      case "s3-buckets": {
        await listBucketsInto(side, gen, loc.profile, ac.signal)
        break
      }
      case "s3": {
        await listPrefixInto(side, gen, loc, null, [], ac.signal)
        break
      }
      case "local": {
        const entries = await local.listDir(loc.dir, st.config.ui.showHidden)
        applyEntries(side, gen, entries, false, null, true)
        break
      }
    }
  } catch (err) {
    const c = classifyError(err, { profile: activeProfileOf(loc) })
    if (c.kind === "aborted") return
    if (stillCurrent(side, gen)) {
      setPane(side, { loading: false, error: c.message, errorHint: c.hint, entries: [] })
    }
  }
}

function activeProfileOf(loc: Location): string {
  return loc.type === "local" ? useApp.getState().profile : loc.profile
}

function stillCurrent(side: PaneSide, gen: number): boolean {
  return useApp.getState().panes[side].gen === gen
}

function applyEntries(
  side: PaneSide,
  gen: number,
  entries: Entry[],
  truncated: boolean,
  nextToken: string | null,
  cache: boolean,
): void {
  if (!stillCurrent(side, gen)) return
  const p = pane(side)
  if (cache) {
    listingCache.set(locationKey(p.location), { entries, truncated, nextToken, at: Date.now() })
    if (listingCache.size > CACHE_MAX) {
      const oldest = listingCache.keys().next().value
      if (oldest !== undefined) listingCache.delete(oldest)
    }
  }
  const view = viewOf(entries, p.filter, p.sort, p.sortReverse)
  let cursor = clampCursor(p.cursor, view.length)
  const land = landOn[side]
  if (land) {
    cursor = indexOfName(view, land)
    landOn[side] = null
  }
  setPane(side, {
    entries,
    truncated,
    nextToken,
    loading: false,
    cursor,
    scroll: scrollFor(cursor, p.scroll, listHeight, view.length),
  })
}

async function listBucketsInto(side: PaneSide, gen: number, profile: string, signal: AbortSignal): Promise<void> {
  const st = useApp.getState()
  const pinned = pinnedBucketsFor(st.config, profile)
  let owned: Entry[] = []
  let listDenied = false
  try {
    owned = await s3.listBuckets(profile, signal)
  } catch (err) {
    const c = classifyError(err, { profile })
    if (c.kind === "aborted") return
    // No ListAllMyBuckets permission is common; pinned buckets may still work.
    if (c.kind === "access-denied" && pinned.length > 0) {
      listDenied = true
    } else {
      throw err
    }
  }
  const byName = new Map(owned.map((e) => [e.name, e]))
  for (const name of pinned) {
    const existing = byName.get(name)
    if (existing) {
      existing.pinned = true
    } else {
      byName.set(name, { name, kind: "bucket", key: name, pinned: true, access: "unknown" })
    }
  }
  const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  // discoverable entry point for cross-account buckets invisible to ListBuckets;
  // viewOf sorts "action" entries to the bottom
  entries.push({ name: "pin a bucket by name…", kind: "action", key: ADD_BUCKET_KEY })
  applyEntries(side, gen, entries, false, null, true)
  if (listDenied) toast("ListBuckets denied for this profile — showing pinned buckets only", "info")

  // Probe every bucket in the background (denied buckets render red). This
  // also covers pinned cross-account buckets that ListBuckets never returns.
  for (const e of entries.filter((e) => e.access === "unknown")) {
    updateBucketAccess(side, gen, e.name, "checking")
    void s3
      .probeBucket(profile, e.name, signal)
      .then(() => updateBucketAccess(side, gen, e.name, "ok"))
      .catch((err) => {
        if (classifyError(err).kind === "aborted") return
        updateBucketAccess(side, gen, e.name, "denied")
      })
  }
}

function updateBucketAccess(side: PaneSide, gen: number, bucket: string, access: Entry["access"]): void {
  if (!stillCurrent(side, gen)) return
  const p = pane(side)
  const entries = p.entries.map((e) => (e.name === bucket ? { ...e, access } : e))
  listingCache.set(locationKey(p.location), { entries, truncated: false, nextToken: null, at: Date.now() })
  setPane(side, { entries })
}

async function listPrefixInto(
  side: PaneSide,
  gen: number,
  loc: Extract<Location, { type: "s3" }>,
  token: string | null,
  acc: Entry[],
  signal: AbortSignal,
): Promise<void> {
  let nextToken = token
  let first = acc.length === 0
  do {
    const page = await s3.listPrefixPage(loc.profile, loc.bucket, loc.prefix, nextToken, signal)
    acc = [...acc, ...page.entries]
    nextToken = page.nextToken
    if (acc.length >= LIST_SOFT_CAP && nextToken) {
      applyEntries(side, gen, acc, true, nextToken, true)
      return
    }
    // paint the first page immediately, stream the rest in
    if (first || !nextToken) applyEntries(side, gen, acc, false, null, !nextToken)
    first = false
    if (!stillCurrent(side, gen)) return
  } while (nextToken)
}

export async function loadMore(side: PaneSide): Promise<void> {
  const p = pane(side)
  if (!p.truncated || !p.nextToken || p.location.type !== "s3") return
  const ac = new AbortController()
  aborts[side] = ac
  setPane(side, { loading: true, truncated: false })
  try {
    await listPrefixInto(side, p.gen, p.location, p.nextToken, p.entries, ac.signal)
  } catch (err) {
    const c = classifyError(err)
    if (c.kind !== "aborted" && stillCurrent(side, p.gen)) {
      setPane(side, { loading: false, error: c.message, errorHint: c.hint })
    }
  }
}

// ---------------------------------------------------------------------------
// navigation

export function navigateTo(side: PaneSide, loc: Location, opts: { landOn?: string } = {}): void {
  landOn[side] = opts.landOn ?? null
  setPane(side, {
    location: loc,
    entries: [],
    cursor: 0,
    scroll: 0,
    filter: "",
    filterEditing: false,
    selected: new Set(),
    error: null,
    errorHint: null,
  })
  void startListing(side)
}

export function openEntry(side: PaneSide): void {
  const e = cursorEntry(side)
  const loc = pane(side).location
  if (!e) return
  if (e.kind === "action") {
    setOverlay({ kind: "pin-bucket", side })
    return
  }
  if (e.kind === "bucket") {
    if (e.access === "denied") {
      toast(`Access to bucket ${e.name} is denied`, "error")
      return
    }
    navigateTo(side, { type: "s3", profile: (loc as { profile: string }).profile ?? useApp.getState().profile, bucket: e.name, prefix: "" })
  } else if (e.kind === "dir") {
    if (loc.type === "s3") navigateTo(side, { ...loc, prefix: e.key })
    else if (loc.type === "local") navigateTo(side, { type: "local", dir: e.key })
  } else {
    void showMetadata(side)
  }
}

export function goUp(side: PaneSide): void {
  const loc = pane(side).location
  const parent = parentLocation(loc)
  if (!parent) return
  navigateTo(side, parent, { landOn: childNameFor(loc) ?? undefined })
}

export function toggleLocalPane(side: PaneSide): void {
  const st = useApp.getState()
  const loc = st.panes[side].location
  if (loc.type === "local") {
    navigateTo(side, { type: "s3-buckets", profile: st.profile })
  } else {
    navigateTo(side, { type: "local", dir: resolveLocalStartDir(st.config) })
  }
}

export function refresh(side: PaneSide): void {
  void startListing(side, { force: true })
}

// ---------------------------------------------------------------------------
// cursor / filter / sort / selection

function setCursor(side: PaneSide, cursor: number): void {
  const p = pane(side)
  const len = paneView(side).length
  const c = clampCursor(cursor, len)
  setPane(side, { cursor: c, scroll: scrollFor(c, p.scroll, listHeight, len) })
}

export function moveBy(side: PaneSide, delta: number): void {
  setCursor(side, moveCursor(pane(side).cursor, delta, paneView(side).length))
}

export function moveTo(side: PaneSide, pos: "top" | "bottom"): void {
  setCursor(side, pos === "top" ? 0 : paneView(side).length - 1)
}

export function pageBy(side: PaneSide, dir: 1 | -1): void {
  moveBy(side, dir * Math.max(1, listHeight - 1))
}

export function startFilter(side: PaneSide): void {
  setPane(side, { filterEditing: true })
}

export function filterInput(side: PaneSide, ch: string): void {
  const p = pane(side)
  setPane(side, { filter: p.filter + ch })
  setCursor(side, 0)
}

export function filterBackspace(side: PaneSide): void {
  const p = pane(side)
  if (p.filter.length === 0) {
    setPane(side, { filterEditing: false })
    return
  }
  setPane(side, { filter: p.filter.slice(0, -1) })
  setCursor(side, pane(side).cursor)
}

export function endFilter(side: PaneSide, keep: boolean): void {
  setPane(side, { filterEditing: false, ...(keep ? {} : { filter: "" }) })
  setCursor(side, pane(side).cursor)
}

export function cycleSortMode(side: PaneSide): void {
  const p = pane(side)
  setPane(side, { sort: nextSort(p.sort) })
  setCursor(side, 0)
}

export function toggleSortReverse(side: PaneSide): void {
  setPane(side, { sortReverse: !pane(side).sortReverse })
  setCursor(side, 0)
}

export function toggleSelect(side: PaneSide): void {
  const p = pane(side)
  const e = cursorEntry(side)
  if (!e) return
  if (p.location.type === "s3-buckets") return // no bulk ops on buckets
  const selected = new Set(p.selected)
  if (selected.has(e.key)) selected.delete(e.key)
  else selected.add(e.key)
  setPane(side, { selected })
  moveBy(side, 1)
}

export function clearSelection(side: PaneSide): void {
  setPane(side, { selected: new Set() })
}

// ---------------------------------------------------------------------------
// profile & buckets

export async function switchProfile(name: string): Promise<void> {
  const st = useApp.getState()
  const info = st.profiles.find((p) => p.name === name)
  if (info) setProfileRegion(info.name, info.region)
  const config = { ...st.config, lastProfile: name }
  saveConfig(config)
  useApp.setState({ profile: name, config, overlay: null })
  for (const side of ["left", "right"] as const) {
    if (st.panes[side].location.type !== "local") {
      navigateTo(side, { type: "s3-buckets", profile: name })
    }
  }
  toast(`Profile: ${name}`, "success")
}

export async function reloadProfiles(): Promise<void> {
  const profiles = await listProfiles()
  for (const p of profiles) setProfileRegion(p.name, p.region)
  useApp.setState({ profiles })
}

export function pinBucket(side: PaneSide, bucket: string): void {
  const st = useApp.getState()
  const name = bucket.trim().replace(/^s3:\/\//, "").replace(/\/.*$/, "")
  if (!name) return
  const config = withPinnedBucket(st.config, st.profile, name)
  saveConfig(config)
  useApp.setState({ config, overlay: null })
  invalidateListing({ type: "s3-buckets", profile: st.profile })
  navigateTo(side, { type: "s3", profile: st.profile, bucket: name, prefix: "" })
  toast(`Pinned bucket ${name}`, "success")
}

export function unpinBucket(bucket: string): void {
  const st = useApp.getState()
  const config = withoutPinnedBucket(st.config, st.profile, bucket)
  saveConfig(config)
  useApp.setState({ config, overlay: null })
  refreshLocation({ type: "s3-buckets", profile: st.profile })
  toast(`Unpinned bucket ${bucket}`, "info")
}

// ---------------------------------------------------------------------------
// clipboard / metadata / preview

export async function copyUri(side: PaneSide): Promise<void> {
  const e = cursorEntry(side)
  const loc = pane(side).location
  if (!e || e.kind === "action") return
  let text: string
  if (loc.type === "s3") text = s3Uri(loc.bucket, e.key)
  else if (loc.type === "s3-buckets") text = `s3://${e.name}`
  else text = e.key
  await copyToClipboard(text)
  toast(`Copied ${text}`, "success")
}

export async function copyPresignedUrl(side: PaneSide): Promise<void> {
  const e = cursorEntry(side)
  const loc = pane(side).location
  if (!e || loc.type !== "s3" || e.kind !== "file") {
    toast("Presigned URLs are for S3 objects", "info")
    return
  }
  const st = useApp.getState()
  try {
    const url = await s3.presignGetUrl(loc.profile, loc.bucket, e.key, st.config.ui.presignExpirySeconds)
    await copyToClipboard(url)
    toast(`Copied presigned URL (${Math.round(st.config.ui.presignExpirySeconds / 60)} min)`, "success")
  } catch (err) {
    toast(classifyError(err, { profile: loc.profile }).message, "error")
  }
}

export async function showMetadata(side: PaneSide): Promise<void> {
  const e = cursorEntry(side)
  const loc = pane(side).location
  if (!e || e.kind !== "file") return
  if (loc.type === "local") {
    toast("Metadata view is for S3 objects", "info")
    return
  }
  if (loc.type !== "s3") return
  const title = s3Uri(loc.bucket, e.key)
  setOverlay({ kind: "metadata", title, rows: [], loading: true })
  try {
    const h = await s3.headObject(loc.profile, loc.bucket, e.key)
    const rows: Array<[string, string]> = []
    const add = (k: string, v: unknown) => {
      if (v !== undefined && v !== null && v !== "") rows.push([k, String(v)])
    }
    add("Size", h.ContentLength)
    add("Last modified", h.LastModified?.toISOString())
    add("Content type", h.ContentType)
    add("ETag", h.ETag)
    add("Storage class", h.StorageClass ?? "STANDARD")
    add("Encryption", h.ServerSideEncryption)
    add("KMS key", h.SSEKMSKeyId)
    add("Version ID", h.VersionId)
    for (const [k, v] of Object.entries(h.Metadata ?? {})) add(`x-amz-meta-${k}`, v)
    const cur = useApp.getState().overlay
    if (cur?.kind === "metadata" && cur.title === title) {
      setOverlay({ kind: "metadata", title, rows, loading: false })
    }
  } catch (err) {
    const cur = useApp.getState().overlay
    if (cur?.kind === "metadata" && cur.title === title) {
      setOverlay(null)
      toast(classifyError(err, { profile: loc.profile }).message, "error")
    }
  }
}

export async function showPreview(side: PaneSide): Promise<void> {
  const e = cursorEntry(side)
  const loc = pane(side).location
  if (!e || e.kind !== "file") return
  if (e.size !== undefined && e.size > PREVIEW_MAX_BYTES) {
    toast(`Too large to preview (limit ${PREVIEW_MAX_BYTES / 1024}K)`, "info")
    return
  }
  const title = loc.type === "s3" ? s3Uri(loc.bucket, e.key) : e.key
  setOverlay({ kind: "preview", title, content: "", filetype: filetypeOf(e.name), loading: true, error: null })
  try {
    let bytes: Uint8Array
    if (loc.type === "s3") {
      const out = await s3.getObjectBody(loc.profile, loc.bucket, e.key)
      bytes = await out.Body!.transformToByteArray()
    } else {
      bytes = new Uint8Array(await Bun.file(e.key).arrayBuffer())
    }
    if (bytes.length > PREVIEW_MAX_BYTES) throw new Error("Too large to preview")
    if (looksBinary(bytes)) throw new Error("Binary content — not previewable")
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
    const cur = useApp.getState().overlay
    if (cur?.kind === "preview" && cur.title === title) {
      setOverlay({ kind: "preview", title, content, filetype: filetypeOf(e.name), loading: false, error: null })
    }
  } catch (err) {
    const cur = useApp.getState().overlay
    if (cur?.kind === "preview" && cur.title === title) {
      const msg = err instanceof Error ? err.message : classifyError(err).message
      setOverlay({ kind: "preview", title, content: "", filetype: null, loading: false, error: msg })
    }
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192)
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

const FILETYPES: Record<string, string> = {
  js: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript",
  json: "json", md: "markdown", py: "python", sh: "bash", yaml: "yaml", yml: "yaml",
  toml: "toml", html: "html", css: "css", sql: "sql", csv: "csv", txt: "text",
}

function filetypeOf(name: string): string | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  return FILETYPES[ext] ?? null
}

// ---------------------------------------------------------------------------
// delete

/** Expanded keys/paths awaiting confirmation, keyed by overlay identity. */
let pendingDelete: { s3Keys: string[]; localPaths: string[] } | null = null

export function requestDelete(side: PaneSide): void {
  const p = pane(side)
  const loc = p.location
  if (loc.type === "s3-buckets") {
    const e = cursorEntry(side)
    if (!e || e.kind === "action") return
    if (e.pinned) setOverlay({ kind: "unpin-bucket", side, bucket: e.name })
    else toast("Bucket deletion is not supported (unpin works on pinned buckets)", "info")
    return
  }
  const items = selectionOrCursor(side)
  if (items.length === 0) return
  const hasDir = items.some((i) => i.kind === "dir")
  const needTyped = items.length > 1 ? "DELETE" : hasDir ? (items[0]?.name ?? "DELETE") : null
  pendingDelete = null
  setOverlay({
    kind: "confirm-delete",
    side,
    items,
    expanded: null,
    needTyped,
    typed: "",
    busy: false,
    error: null,
  })
  void expandDelete(side, items)
}

async function expandDelete(side: PaneSide, items: Entry[]): Promise<void> {
  const loc = pane(side).location
  const s3Keys: string[] = []
  const localPaths: string[] = []
  let count = 0
  let bytes = 0
  try {
    for (const item of items) {
      if (loc.type === "s3") {
        if (item.kind === "file") {
          s3Keys.push(item.key)
          count++
          bytes += item.size ?? 0
        } else {
          for await (const page of s3.walkPrefix(loc.profile, loc.bucket, item.key)) {
            for (const o of page) {
              s3Keys.push(o.key)
              count++
              bytes += o.size
            }
          }
        }
      } else if (loc.type === "local") {
        localPaths.push(item.key)
        if (item.kind === "file") {
          count++
          bytes += item.size ?? 0
        } else {
          const files = await walkDirSafe(item.key)
          count += files.length
          bytes += files.reduce((a, f) => a + f.size, 0)
        }
      }
    }
    pendingDelete = { s3Keys, localPaths }
    const cur = useApp.getState().overlay
    if (cur?.kind === "confirm-delete" && cur.side === side) {
      setOverlay({ ...cur, expanded: { count, bytes } })
    }
  } catch (err) {
    const cur = useApp.getState().overlay
    if (cur?.kind === "confirm-delete" && cur.side === side) {
      setOverlay({ ...cur, error: classifyError(err).message })
    }
  }
}

async function walkDirSafe(dir: string) {
  const { walkDir } = await import("../fs/local.ts")
  return walkDir(dir)
}

export async function confirmDelete(): Promise<void> {
  const st = useApp.getState()
  const ov = st.overlay
  if (ov?.kind !== "confirm-delete" || ov.busy) return
  if (ov.needTyped && ov.typed !== ov.needTyped) return
  if (!pendingDelete) return // still expanding
  const loc = st.panes[ov.side].location
  setOverlay({ ...ov, busy: true, error: null })
  try {
    if (loc.type === "s3") {
      const errors = await s3.deleteBatch(loc.profile, loc.bucket, pendingDelete.s3Keys)
      if (errors.length > 0) {
        setOverlay({ ...ov, busy: false, error: `${errors.length} objects failed: ${errors[0]}` })
        return
      }
    } else if (loc.type === "local") {
      for (const p of pendingDelete.localPaths) await local.removeRecursive(p)
    }
    setOverlay(null)
    clearSelection(ov.side)
    refreshLocation(loc)
    toast(`Deleted ${pendingDelete.s3Keys.length + pendingDelete.localPaths.length} item(s)`, "success")
    pendingDelete = null
  } catch (err) {
    setOverlay({ ...ov, busy: false, error: classifyError(err).message })
  }
}

// ---------------------------------------------------------------------------
// quit

export function requestQuit(exit: () => void): void {
  const running = useApp.getState().jobs.some((j) => j.status === "running" || j.status === "expanding")
  if (running) setOverlay({ kind: "quit-confirm" })
  else exit()
}

export function describeLocation(loc: Location): string {
  return locationTitle(loc)
}

export { leafName }
