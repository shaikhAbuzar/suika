import { loadSharedConfigFiles } from "@smithy/shared-ini-file-loader"
import type { ProfileInfo } from "../core/types.ts"

export async function listProfiles(): Promise<ProfileInfo[]> {
  const { configFile, credentialsFile } = await loadSharedConfigFiles({ ignoreCache: true })
  const names = new Set<string>([...Object.keys(configFile), ...Object.keys(credentialsFile)])
  if (names.size === 0) names.add("default")
  return [...names].sort().map((name) => {
    const section = { ...credentialsFile[name], ...configFile[name] }
    return {
      name,
      region: section.region || "us-east-1",
      isSSO: Boolean(section.sso_session || section.sso_start_url),
    }
  })
}
