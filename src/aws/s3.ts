import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { leafName } from "../core/keys.ts"
import type { Entry } from "../core/types.ts"
import { bucketClient, clientFor, profileRegion } from "./clients.ts"

export const PAGE_SIZE = 1000
/** Objects above this fail s3→s3 CopyObject; multipart copy is not in v1. */
export const COPY_OBJECT_LIMIT = 5 * 1024 * 1024 * 1024

export async function listBuckets(profile: string, signal?: AbortSignal): Promise<Entry[]> {
  const client = clientFor(profile, profileRegion(profile))
  const out = await client.send(new ListBucketsCommand({}), { abortSignal: signal })
  // "unknown" — being listed only proves ownership, not that we can read the
  // contents; the store probes every bucket and marks it ok/denied
  return (out.Buckets ?? []).map((b) => ({
    name: b.Name ?? "",
    kind: "bucket" as const,
    key: b.Name ?? "",
    mtime: b.CreationDate,
    access: "unknown" as const,
  }))
}

export interface ListPage {
  entries: Entry[]
  nextToken: string | null
}

export async function listPrefixPage(
  profile: string,
  bucket: string,
  prefix: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<ListPage> {
  const client = await bucketClient(profile, bucket, signal)
  const out = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
      MaxKeys: PAGE_SIZE,
      ContinuationToken: token ?? undefined,
    }),
    { abortSignal: signal },
  )
  const entries: Entry[] = []
  for (const p of out.CommonPrefixes ?? []) {
    if (!p.Prefix) continue
    entries.push({ name: leafName(p.Prefix), kind: "dir", key: p.Prefix })
  }
  for (const o of out.Contents ?? []) {
    if (!o.Key || o.Key === prefix) continue // skip the folder-marker object itself
    entries.push({
      name: leafName(o.Key),
      kind: "file",
      key: o.Key,
      size: o.Size,
      mtime: o.LastModified,
      storageClass: o.StorageClass,
    })
  }
  return { entries, nextToken: out.IsTruncated ? (out.NextContinuationToken ?? null) : null }
}

export interface WalkedObject {
  key: string
  size: number
}

/** Every object under a prefix (no delimiter) — for recursive copy/delete. */
export async function* walkPrefix(
  profile: string,
  bucket: string,
  prefix: string,
  signal?: AbortSignal,
): AsyncGenerator<WalkedObject[]> {
  const client = await bucketClient(profile, bucket, signal)
  let token: string | undefined
  do {
    const out = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: PAGE_SIZE, ContinuationToken: token }),
      { abortSignal: signal },
    )
    yield (out.Contents ?? [])
      .filter((o) => o.Key !== undefined)
      .map((o) => ({ key: o.Key as string, size: o.Size ?? 0 }))
    token = out.IsTruncated ? out.NextContinuationToken : undefined
  } while (token)
}

/** Probe access to a bucket (works for pinned cross-account buckets) and warm its region cache. */
export async function probeBucket(profile: string, bucket: string, signal?: AbortSignal): Promise<void> {
  const client = await bucketClient(profile, bucket, signal)
  await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }), { abortSignal: signal })
}

export interface ObjectMeta {
  rows: Array<[string, string]>
}

export async function headObject(profile: string, bucket: string, key: string, signal?: AbortSignal) {
  const client = await bucketClient(profile, bucket, signal)
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal })
}

export async function presignGetUrl(
  profile: string,
  bucket: string,
  key: string,
  expiresIn: number,
): Promise<string> {
  const client = await bucketClient(profile, bucket)
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
}

export async function getObjectBody(profile: string, bucket: string, key: string, signal?: AbortSignal) {
  const client = await bucketClient(profile, bucket, signal)
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal })
  if (!out.Body) throw new Error(`Empty response body for s3://${bucket}/${key}`)
  return out
}

/** Server-side copy. The client must be in the destination bucket's region. */
export async function copyObject(
  profile: string,
  srcBucket: string,
  srcKey: string,
  dstBucket: string,
  dstKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const client = await bucketClient(profile, dstBucket, signal)
  await client.send(
    new CopyObjectCommand({
      Bucket: dstBucket,
      Key: dstKey,
      CopySource: encodeURIComponent(`${srcBucket}/${srcKey}`).replace(/%2F/g, "/"),
    }),
    { abortSignal: signal },
  )
}

export async function deleteObject(profile: string, bucket: string, key: string, signal?: AbortSignal): Promise<void> {
  const client = await bucketClient(profile, bucket, signal)
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal })
}

/** Delete keys in batches of 1000. Returns per-key error messages, if any. */
export async function deleteBatch(
  profile: string,
  bucket: string,
  keys: string[],
  signal?: AbortSignal,
  onProgress?: (deleted: number) => void,
): Promise<string[]> {
  const client = await bucketClient(profile, bucket, signal)
  const errors: string[] = []
  let deleted = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000)
    const out = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((k) => ({ Key: k })), Quiet: true },
      }),
      { abortSignal: signal },
    )
    for (const e of out.Errors ?? []) {
      errors.push(`${e.Key}: ${e.Code ?? ""} ${e.Message ?? ""}`.trim())
    }
    deleted += chunk.length - (out.Errors?.length ?? 0)
    onProgress?.(deleted)
  }
  return errors
}

/** Multipart-capable streaming upload with progress callbacks. */
export async function uploadStream(
  profile: string,
  bucket: string,
  key: string,
  body: NodeJS.ReadableStream | ReadableStream | Blob,
  signal: AbortSignal | undefined,
  onBytes: (loaded: number) => void,
): Promise<void> {
  const client = await bucketClient(profile, bucket, signal)
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: key, Body: body as never },
    queueSize: 3,
    abortController: undefined,
  })
  upload.on("httpUploadProgress", (p) => {
    if (p.loaded !== undefined) onBytes(p.loaded)
  })
  if (signal) {
    const abort = () => void upload.abort().catch(() => {})
    if (signal.aborted) await upload.abort()
    else signal.addEventListener("abort", abort, { once: true })
  }
  await upload.done()
}
