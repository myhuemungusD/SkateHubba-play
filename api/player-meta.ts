/**
 * Per-profile social card for `/player/{uid}`.
 *
 * WHY THIS EXISTS: `vercel.json` rewrites every path to `/index.html`, so a
 * crawler fetching `/player/{uid}` receives byte-identical markup to the
 * homepage — the hard-coded `og:*` tags in `index.html`. Every shared profile
 * link therefore previewed as a generic "SkateHubba™ — For the Love of the
 * Game" card, with no username, record, or avatar. Crawlers do not run
 * JavaScript, so no client-side fix can change that; the tags have to be right
 * in the first byte of the response.
 *
 * ── Only crawlers reach this handler ──
 * The rewrite in `vercel.json` carries a `has: user-agent` condition, so a real
 * visitor still gets the static `index.html` straight from the CDN with no
 * function invocation, no cold start, and no added latency. That also means the
 * response below is written for a crawler and nothing else: it is a bare
 * metadata document, not the app. If a human somehow lands here (a spoofed UA,
 * a curl), the `<meta http-equiv="refresh">` plus the visible link send them to
 * the real page rather than a dead end.
 *
 * If the UA list misses a crawler, that crawler gets the old generic card —
 * the previous behaviour. Degradation, not breakage.
 *
 * ── Reads are unauthenticated by design ──
 * `firestore.rules` makes `users/{uid}` publicly `get`-able (single doc only;
 * collection `list` stays signed-in), so this handler needs no credentials and
 * never touches the Admin SDK. That keeps a route hit by bots cheap and means a
 * leaked function cannot read anything a visitor could not already fetch.
 *
 * Until those rules are published this fetch returns 403 and the handler falls
 * back to the generic card — i.e. exactly today's behaviour, so shipping this
 * ahead of the rules deploy is safe.
 */

/** Named Firestore database — must match `src/firebase.ts` FIRESTORE_DB_NAME. */
const FIRESTORE_DB_NAME = "skatehubba";

/** Canonical site origin, used for absolute `og:url` / image fallbacks. */
const SITE_ORIGIN = "https://skatehubba.com";

/** Generic card, used whenever the profile can't be resolved. */
const FALLBACK_TITLE = "SkateHubba™ — For the Love of the Game";
const FALLBACK_DESCRIPTION = "The first async S.K.A.T.E. trick battle game.";
const FALLBACK_IMAGE = `${SITE_ORIGIN}/og-image.png`;

/**
 * Firebase uids are URL-safe base64-ish. Validated before interpolation into
 * the Firestore REST URL so a crafted path segment can't redirect the fetch at
 * another endpoint.
 */
const UID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

/** Give up rather than hold a crawler connection open on a slow backend. */
const FETCH_TIMEOUT_MS = 2500;

interface ApiRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
}
interface ApiResponse {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
}

/** Minimal shape of the Firestore REST document response we consume. */
interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
}

/**
 * Escape for an HTML attribute. Every interpolated value below is
 * user-controlled (usernames are user-chosen), so this is the boundary that
 * stops a username like `"><script>` from breaking out of the tag.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Read the first value of a possibly-repeated query param. */
function firstParam(req: ApiRequest, key: string): string | null {
  const raw = req.query?.[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readString(fields: Record<string, FirestoreValue>, key: string): string | null {
  const v = fields[key]?.stringValue;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Firestore REST encodes integers as strings; absent counters mean zero. */
function readInt(fields: Record<string, FirestoreValue>, key: string): number {
  const raw = fields[key]?.integerValue;
  if (typeof raw !== "string") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

interface CardContent {
  title: string;
  description: string;
  image: string;
}

/**
 * Fetch the public profile and turn it into card copy.
 *
 * Returns null on anything unexpected — missing project id, a non-200, a
 * malformed body, a timeout. The caller then serves the generic card, which is
 * strictly better than a broken preview or a 500 in a crawler's face.
 */
async function loadCard(uid: string): Promise<CardContent | null> {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return null;

  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${FIRESTORE_DB_NAME}/documents/users/${uid}`;
  const url = apiKey ? `${base}?key=${encodeURIComponent(apiKey)}` : base;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    // 403 is the expected response until the public-get rule is published, and
    // 404 is a uid that doesn't exist. Both mean "generic card".
    if (!res.ok) return null;
    const body = (await res.json()) as { fields?: Record<string, FirestoreValue> };
    const fields = body.fields;
    if (!fields) return null;

    const username = readString(fields, "username");
    if (!username) return null;

    const wins = readInt(fields, "wins");
    const losses = readInt(fields, "losses");
    const isPro = fields["isVerifiedPro"]?.booleanValue === true;

    // Only a record worth showing goes in the description; a brand-new account
    // reads better as an invitation than as "0W - 0L".
    const record = wins + losses > 0 ? `${wins}W – ${losses}L` : "New to SkateHubba";
    const pro = isPro ? " · Verified Pro" : "";

    return {
      title: `@${username} on SkateHubba`,
      description: `${record}${pro}. Challenge them to a game of S.K.A.T.E.`,
      // The avatar is a Firebase Storage download URL (absolute). Anything
      // else — including a relative or non-https value — falls back, since a
      // crawler will not resolve it.
      image:
        readString(fields, "profileImageUrl")?.startsWith("https://") === true
          ? (readString(fields, "profileImageUrl") as string)
          : FALLBACK_IMAGE,
    };
  } catch {
    // Timeout, DNS, malformed JSON — all the same outcome.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Render the metadata document. No scripts, so the CSP never has to relax. */
function renderCard(card: CardContent, canonical: string): string {
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const image = escapeHtml(card.image);
  const url = escapeHtml(canonical);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="SkateHubba" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${image}" />
    <meta http-equiv="refresh" content="0; url=${url}" />
  </head>
  <body>
    <a href="${url}">${title}</a>
  </body>
</html>`;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const rawUid = firstParam(req, "uid");
  const uid = rawUid && UID_SHAPE.test(rawUid) ? rawUid : null;
  const canonical = uid ? `${SITE_ORIGIN}/player/${uid}` : SITE_ORIGIN;

  const card = uid ? await loadCard(uid) : null;
  const content: CardContent = card ?? {
    title: FALLBACK_TITLE,
    description: FALLBACK_DESCRIPTION,
    image: FALLBACK_IMAGE,
  };

  // Always 200: a crawler that gets a 4xx drops the preview entirely, so an
  // unknown uid should still yield the generic card rather than nothing.
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Cache at the edge so a link shared into a busy channel doesn't re-hit
  // Firestore for every crawler. Short enough that a username or avatar change
  // propagates within the hour.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(renderCard(content, canonical));
}
