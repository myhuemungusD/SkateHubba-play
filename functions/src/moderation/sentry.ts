/**
 * Report a moderation failure to Sentry without taking a dependency on the
 * SDK. An empty DSN is a no-op so a missing secret cannot block the
 * fail-safe review path.
 */
export function parseSentryDsn(dsn: string): { key: string; storeUrl: string } | null {
  if (dsn.length === 0) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const key = url.username;
  const project = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  if (key.length === 0 || project.length === 0) return null;
  return { key, storeUrl: `${url.protocol}//${url.host}/api/${project}/store/` };
}

export async function captureModerationFailure(
  dsn: string,
  error: unknown,
  extra: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string" && error.length > 0
        ? error
        : "clip moderation failed";
  const res = await fetchImpl(parsed.storeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=skatehubba-moderation, sentry_key=${parsed.key}`,
    },
    body: JSON.stringify({
      message,
      level: "error",
      logger: "clip-moderation",
      extra,
    }),
  });
  return res.ok;
}
