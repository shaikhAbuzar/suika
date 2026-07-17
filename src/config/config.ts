import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export interface UiConfig {
  sort: "name" | "size" | "mtime"
  showHidden: boolean
  presignExpirySeconds: number
}

export interface SuikaConfig {
  version: 1
  lastProfile: string
  profiles: Record<string, { pinnedBuckets: string[] }>
  ui: UiConfig
  localStartDir: string
}

export const DEFAULT_CONFIG: SuikaConfig = {
  version: 1,
  lastProfile: "default",
  profiles: {
    default: { pinnedBuckets: [] },
  },
  ui: { sort: "name", showHidden: false, presignExpirySeconds: 3600 },
  localStartDir: "~",
}

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(base, "suika", "config.json")
}

/** Unknown fields from the file are kept here and written back on save. */
let rawConfig: Record<string, unknown> = {}

export function loadConfig(): SuikaConfig {
  const file = configPath()
  try {
    const text = fs.readFileSync(file, "utf8")
    rawConfig = JSON.parse(text) as Record<string, unknown>
  } catch {
    rawConfig = {}
    saveConfig(structuredClone(DEFAULT_CONFIG))
    return structuredClone(DEFAULT_CONFIG)
  }
  const c = rawConfig as Partial<SuikaConfig>
  const def = structuredClone(DEFAULT_CONFIG)
  return {
    version: 1,
    lastProfile: typeof c.lastProfile === "string" ? c.lastProfile : def.lastProfile,
    profiles: normalizeProfiles(c.profiles) ?? def.profiles,
    ui: { ...def.ui, ...(typeof c.ui === "object" && c.ui !== null ? c.ui : {}) },
    localStartDir: typeof c.localStartDir === "string" ? c.localStartDir : def.localStartDir,
  }
}

function normalizeProfiles(p: unknown): SuikaConfig["profiles"] | null {
  if (typeof p !== "object" || p === null) return null
  const out: SuikaConfig["profiles"] = {}
  for (const [name, val] of Object.entries(p)) {
    const buckets = (val as { pinnedBuckets?: unknown })?.pinnedBuckets
    out[name] = {
      pinnedBuckets: Array.isArray(buckets) ? buckets.filter((b): b is string => typeof b === "string") : [],
    }
  }
  return out
}

export function saveConfig(config: SuikaConfig): void {
  const file = configPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const merged = { ...rawConfig, ...config }
  const tmp = file + `.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", "utf8")
  fs.renameSync(tmp, file)
  rawConfig = merged
}

export function pinnedBucketsFor(config: SuikaConfig, profile: string): string[] {
  return config.profiles[profile]?.pinnedBuckets ?? []
}

export function withPinnedBucket(config: SuikaConfig, profile: string, bucket: string): SuikaConfig {
  const existing = pinnedBucketsFor(config, profile)
  if (existing.includes(bucket)) return config
  return {
    ...config,
    profiles: { ...config.profiles, [profile]: { pinnedBuckets: [...existing, bucket] } },
  }
}

export function withoutPinnedBucket(config: SuikaConfig, profile: string, bucket: string): SuikaConfig {
  const existing = pinnedBucketsFor(config, profile)
  return {
    ...config,
    profiles: { ...config.profiles, [profile]: { pinnedBuckets: existing.filter((b) => b !== bucket) } },
  }
}

export function resolveLocalStartDir(config: SuikaConfig): string {
  const dir = config.localStartDir
  if (dir === "~") return os.homedir()
  if (dir.startsWith("~/")) return path.join(os.homedir(), dir.slice(2))
  return dir
}
