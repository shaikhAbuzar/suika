/** @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { App } from "../src/App.tsx"
import { useApp } from "../src/core/store.ts"
import type { Entry, PaneState } from "../src/core/types.ts"

process.env.SUIKA_TEST = "1" // keeps App's mount effect from running a real initApp

export function fakePane(location: PaneState["location"], entries: Entry[]): PaneState {
  return {
    location,
    entries,
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
    gen: 1,
  }
}

export const bucketEntries: Entry[] = [
  { name: "acme-data-bucket", kind: "bucket", key: "acme-data-bucket", mtime: new Date("2025-12-23T10:00:00"), access: "ok" },
  { name: "shared-datalake", kind: "bucket", key: "shared-datalake", pinned: true, access: "ok" },
  { name: "config-logs-000000000000-eunorth1", kind: "bucket", key: "config-logs-000000000000-eunorth1", mtime: new Date("2026-04-02T12:00:00"), access: "denied" },
  { name: "pin a bucket by name…", kind: "action", key: "__suika-add-bucket" },
]

export const localEntries: Entry[] = [
  { name: "a-directory-with-a-fairly-long-name", kind: "dir", key: "/home/x/a-directory-with-a-fairly-long-name", mtime: new Date("2026-03-20T00:00:00") },
  { name: "notes.md", kind: "file", key: "/home/x/notes.md", size: 5300, mtime: new Date("2026-07-17T13:15:00") },
  { name: "an-even-longer-directory-name-that-exercises-middle-truncation", kind: "dir", key: "/home/x/an-even-longer-directory-name", mtime: new Date("2026-06-28T00:00:00") },
]

/** Put the store into a fully-ready state with deterministic pane contents. */
export function seedStore(): void {
  useApp.setState({
    ready: true,
    fatal: null,
    profile: "default",
    profiles: [{ name: "default", region: "us-east-1", isSSO: false }],
    active: "left",
    overlay: null,
    jobs: [],
    toast: null,
    panes: {
      left: fakePane({ type: "s3-buckets", profile: "default" }, bucketEntries),
      right: fakePane({ type: "local", dir: "/home/x" }, localEntries),
    },
  })
}

/** Render the real App at a given size with seeded panes; returns frame utilities. */
export async function renderApp(width: number, height: number) {
  seedStore()
  const setup = await testRender(<App />, { width, height })
  await setup.renderOnce()
  return setup
}

/** Render the App starting from the not-ready (loading) state. */
export async function renderAppLoading(width: number, height: number) {
  useApp.setState({ ready: false, fatal: null })
  const setup = await testRender(<App />, { width, height })
  await setup.renderOnce()
  return setup
}
