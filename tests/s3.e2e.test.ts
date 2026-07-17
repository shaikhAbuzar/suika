// Opt-in end-to-end test against real S3. Run with:
//   SUIKA_E2E=1 SUIKA_E2E_BUCKET=my-bucket bun test tests/s3.e2e.test.ts
// Creates and deletes objects only under the scratch prefix "suika-e2e-tmp/".
import { describe, expect, test } from "bun:test"
import { setProfileRegion } from "../src/aws/clients.ts"
import { listProfiles } from "../src/aws/profiles.ts"
import {
  copyObject,
  deleteBatch,
  getObjectBody,
  listBuckets,
  listPrefixPage,
  probeBucket,
  uploadStream,
} from "../src/aws/s3.ts"

const enabled = process.env.SUIKA_E2E === "1"
const BUCKET = process.env.SUIKA_E2E_BUCKET ?? ""
const PINNED = process.env.SUIKA_E2E_PINNED_BUCKET ?? ""
const PREFIX = "suika-e2e-tmp/"
const PROFILE = process.env.AWS_PROFILE ?? "default"

describe.skipIf(!enabled)("s3 e2e", () => {
  test("profiles enumerate", async () => {
    const profiles = await listProfiles()
    expect(profiles.length).toBeGreaterThan(0)
    for (const p of profiles) setProfileRegion(p.name, p.region)
  })

  test("ListBuckets works", async () => {
    const buckets = await listBuckets(PROFILE)
    expect(Array.isArray(buckets)).toBe(true)
  })

  test.skipIf(!PINNED)("pinned cross-account bucket probes and lists", async () => {
    await probeBucket(PROFILE, PINNED)
    const page = await listPrefixPage(PROFILE, PINNED, "", null)
    expect(page.entries.length).toBeGreaterThan(0)
  })

  test.skipIf(!BUCKET)("upload → download → copy → delete round-trip", async () => {
    const payload = `suika e2e\n` + "x".repeat(8192)
    await uploadStream(PROFILE, BUCKET, PREFIX + "a.txt", new Blob([payload]), undefined, () => {})

    const out = await getObjectBody(PROFILE, BUCKET, PREFIX + "a.txt")
    const text = await out.Body!.transformToString()
    expect(text).toBe(payload)

    await copyObject(PROFILE, BUCKET, PREFIX + "a.txt", BUCKET, PREFIX + "b.txt")
    const page = await listPrefixPage(PROFILE, BUCKET, PREFIX, null)
    expect(page.entries.map((e) => e.name).sort()).toEqual(["a.txt", "b.txt"])

    const errors = await deleteBatch(PROFILE, BUCKET, page.entries.map((e) => e.key))
    expect(errors).toEqual([])
    const after = await listPrefixPage(PROFILE, BUCKET, PREFIX, null)
    expect(after.entries.length).toBe(0)
  }, 60_000)
})
