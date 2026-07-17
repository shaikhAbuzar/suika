# suika 🍉

A fast, dual-pane S3 terminal file manager (Midnight Commander style), built with
[OpenTUI](https://opentui.com) and Bun.

```
┌ s3://shared-datalake/reports/ ──────────┐┌ /Users/you/Downloads ────────────────┐
│  ▸ monthly/                             ││  reports/                            │
│    quarterly/                           ││  data-2026.csv         1.2M  Jul 12  │
│    summary-2026-07.parquet   48M Jul 17 ││  notes.md              2.1K  Jul 10  │
│  …                                      ││  …                                   │
└ 1,204 items · name ─────────────────────┘└ 38 items · name ─────────────────────┘
 default @ us-east-1                                              ?:help  q:quit
```

## Why

- `aws s3 ls` only shows buckets **owned** by your account. Buckets shared with you
  via cross-account bucket policies (a partner's data lake, a shared archive) are
  invisible to it. suika keeps a per-profile list of **pinned buckets** that are
  merged into the bucket list, with a live access check.
- Browsing, diffing paths, downloading, and cleaning up with the AWS CLI is slow.
  A file-manager UI with two panes is faster for day-to-day work.

## Install

Grab a prebuilt binary from the [latest release](https://github.com/shaikhAbuzar/suika/releases/latest):

| Platform | Asset |
|---|---|
| Linux x86_64 | `suika-<version>-linux-x64` |
| Linux arm64 | `suika-<version>-linux-arm64` |
| macOS Apple Silicon | `suika-<version>-darwin-arm64` |
| macOS Intel | `suika-<version>-darwin-x64` |

```bash
chmod +x suika-*
mv suika-* /usr/local/bin/suika
suika
```

Credentials come from the standard AWS config files (`~/.aws/config`,
`~/.aws/credentials`) — static keys, SSO, and assumed roles all work.

### Build from source (for the daring souls)

All you need is [Bun](https://bun.sh):

```bash
git clone https://github.com/shaikhAbuzar/suika.git && cd suika
bun install
bun start            # run it straight from source
bun run build        # or forge your own self-contained ./suika binary
```

Works on any platform Bun and OpenTUI support — each machine pulls its own
native terminal core during `bun install`.

## The dual-pane model

Each pane shows either **S3** (bucket list → prefixes/objects) or the **local
filesystem** (toggle with `` ` ``). Copy/move always goes from the active pane to
the other pane, so the same two keys cover everything:

| panes | `c` copy / `m` move does |
|---|---|
| S3 → local | download |
| local → S3 | upload (multipart, with progress) |
| S3 → S3 | server-side copy |
| local → local | file copy |

Directories and prefixes are copied recursively. Existing files prompt once per
transfer: overwrite / skip / cancel.

## Keys

Press `?` in the app for this list.

| | |
|---|---|
| `j`/`k`/arrows, `g`/`G`, PgUp/PgDn | move · `Tab` switch pane |
| `Enter`/`l` | open bucket/dir · metadata on files |
| `Backspace`/`h` | up one level |
| `Space` | select (bulk operations) |
| `/` | filter listing · `s` sort name→size→date · `S` reverse |
| `y` | copy `s3://` URI or path · `Y` copy presigned URL |
| `c`/`F5` · `m`/`F6` | copy · move to other pane |
| `d`/`F8` | delete (typed confirmation for prefixes/bulk; unpins pinned buckets) |
| `r` | rename · `R` refresh · `L` load more · `v` preview · `i` metadata |
| `p` | switch AWS profile · `b` open/pin a bucket by name · `` ` `` S3↔local |
| `t` | transfer queue · `?` help · `q` quit |

## Pinned buckets

Config lives at `~/.config/suika/config.json`:

```json
{
  "lastProfile": "default",
  "profiles": {
    "default": { "pinnedBuckets": ["shared-datalake"] }
  }
}
```

Buckets shared with you cross-account never appear in `ListBuckets`, so suika
lets you add them by name: press `b` anywhere, or hit
Enter on the `+ pin a bucket by name…` row at the bottom of the bucket list.
The name is saved to the config, so it shows up on every future run. Pinned
buckets sort to the top of the bucket list with a `⚲` pin mark before the name.
`d` on a pinned bucket unpins it (never touches the bucket itself).

Every bucket is access-probed in the background when the list loads: buckets
you can actually read are yellow, buckets that deny access are red with a `✗`
before the name (`…` while the check is in flight). Being in the list only
proves the bucket exists in your account — the probe proves you can list its
contents.

## Safety

- Deleting a prefix or multiple items requires typing the prefix name (or `DELETE`)
  after suika counts the exact number of objects and bytes affected.
- Deletes are batched (`DeleteObjects`, 1000 keys per call) with per-key error reporting.
- Move deletes each source object only after its copy succeeded.
- S3→S3 copies of objects over 5 GiB fail up front with a clear message
  (single-request `CopyObject` limit; multipart copy not implemented yet).
- Buckets can never be created or deleted from suika.

## Development

```bash
bun test                                          # unit tests
bunx tsc --noEmit                                 # typecheck
SUIKA_E2E=1 SUIKA_E2E_BUCKET=<scratch-bucket> \
  bun test tests/s3.e2e.test.ts                   # opt-in e2e against real S3
```

Source layout: `src/aws/` (clients, region resolution, S3 ops), `src/fs/` (local
listing/walking), `src/core/` (store, pure pane logic, transfer engine),
`src/ui/` (OpenTUI React components), `src/keymap.ts` (single source of truth
for keys + help).
