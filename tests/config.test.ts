import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

let tmpDir: string
let originalXdg: string | undefined

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suika-test-"))
  originalXdg = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = tmpDir
})

afterEach(() => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalXdg
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

async function freshConfigModule() {
  // bust the module cache so rawConfig state resets per test
  return import(`../src/config/config.ts?${Math.random()}`) as Promise<typeof import("../src/config/config.ts")>
}

describe("config", () => {
  test("first run seeds default config with no pinned buckets", async () => {
    const cfg = await freshConfigModule()
    const c = cfg.loadConfig()
    expect(c.profiles["default"]?.pinnedBuckets).toEqual([])
    expect(fs.existsSync(path.join(tmpDir, "suika", "config.json"))).toBe(true)
  })

  test("pin and unpin round-trip", async () => {
    const cfg = await freshConfigModule()
    let c = cfg.loadConfig()
    c = cfg.withPinnedBucket(c, "default", "shared-datalake")
    c = cfg.withPinnedBucket(c, "default", "other-bucket")
    expect(cfg.pinnedBucketsFor(c, "default")).toEqual(["shared-datalake", "other-bucket"])
    c = cfg.withPinnedBucket(c, "default", "other-bucket") // idempotent
    expect(cfg.pinnedBucketsFor(c, "default")).toEqual(["shared-datalake", "other-bucket"])
    c = cfg.withoutPinnedBucket(c, "default", "shared-datalake")
    expect(cfg.pinnedBucketsFor(c, "default")).toEqual(["other-bucket"])
  })

  test("unknown fields survive a save round-trip", async () => {
    const cfg = await freshConfigModule()
    const file = cfg.configPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, lastProfile: "x", futureField: { keep: true } }),
      "utf8",
    )
    const c = cfg.loadConfig()
    expect(c.lastProfile).toBe("x")
    cfg.saveConfig(c)
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))
    expect(raw.futureField).toEqual({ keep: true })
  })

  test("malformed profile entries are normalized", async () => {
    const cfg = await freshConfigModule()
    const file = cfg.configPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ profiles: { p1: { pinnedBuckets: ["a", 42, "b"] }, p2: {} } }), "utf8")
    const c = cfg.loadConfig()
    expect(c.profiles["p1"]?.pinnedBuckets).toEqual(["a", "b"])
    expect(c.profiles["p2"]?.pinnedBuckets).toEqual([])
  })

  test("localStartDir resolves ~", async () => {
    const cfg = await freshConfigModule()
    const c = cfg.loadConfig()
    expect(cfg.resolveLocalStartDir(c)).toBe(os.homedir())
    expect(cfg.resolveLocalStartDir({ ...c, localStartDir: "~/x" })).toBe(path.join(os.homedir(), "x"))
    expect(cfg.resolveLocalStartDir({ ...c, localStartDir: "/abs" })).toBe("/abs")
  })
})
