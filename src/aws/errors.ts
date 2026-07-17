export type ErrorKind = "sso-expired" | "access-denied" | "no-such-bucket" | "network" | "aborted" | "other"

export interface ClassifiedError {
  kind: ErrorKind
  message: string
  hint: string | null
}

export function classifyError(err: unknown, context?: { profile?: string }): ClassifiedError {
  const e = err as { name?: string; message?: string; code?: string } | undefined
  const name = e?.name ?? ""
  const message = e?.message ?? String(err)
  const code = e?.code ?? ""
  const blob = `${name} ${code} ${message}`

  if (name === "AbortError" || /aborted/i.test(blob)) {
    return { kind: "aborted", message: "Aborted", hint: null }
  }
  if (
    /sso/i.test(blob) &&
    (/expired|invalid|refresh|login|token/i.test(blob) || name === "TokenProviderFailure")
  ) {
    const profile = context?.profile ?? "<profile>"
    return {
      kind: "sso-expired",
      message: "SSO session is expired or invalid.",
      hint: `Run \`aws sso login --profile ${profile}\` in another terminal, then press r to retry.`,
    }
  }
  if (/ExpiredToken|TokenRefreshRequired|InvalidToken|CredentialsProviderError|Could not load credentials/i.test(blob)) {
    return {
      kind: "sso-expired",
      message: "AWS credentials could not be loaded or are expired.",
      hint: `Check credentials for this profile (aws sts get-caller-identity --profile ${context?.profile ?? "<profile>"}), then press r to retry.`,
    }
  }
  if (/AccessDenied|Forbidden|403|not authorized/i.test(blob)) {
    return { kind: "access-denied", message: "Access denied.", hint: null }
  }
  if (/NoSuchBucket/i.test(blob)) {
    return { kind: "no-such-bucket", message: "Bucket does not exist.", hint: null }
  }
  if (/NoSuchKey|NotFound|404/i.test(blob)) {
    return { kind: "no-such-bucket", message: "Not found.", hint: null }
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|NetworkingError|network|socket/i.test(blob)) {
    return { kind: "network", message: "Network error: " + firstLine(message), hint: "Check connectivity, then press r to retry." }
  }
  return { kind: "other", message: firstLine(message) || name || "Unknown error", hint: null }
}

function firstLine(s: string): string {
  return s.split("\n", 1)[0] ?? s
}
