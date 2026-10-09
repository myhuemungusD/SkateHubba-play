/**
 * Android Digital Asset Links, the counterpart of Apple's association file.
 *
 * Served at `/.well-known/assetlinks.json`. Returns 404 until
 * `ANDROID_SHA256_CERT_FINGERPRINTS` is set (comma-separated SHA-256
 * fingerprints of the Play App Signing cert and the upload cert). A bad
 * entry fails the whole response so we never publish a partial file.
 */

interface WellKnownRequest {
  method?: string;
}

interface WellKnownResponse {
  status: (code: number) => WellKnownResponse;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

/** Accepts raw hex or colon-separated hex and returns `AA:BB:...` uppercase. */
function normalizeFingerprint(raw: string): string | null {
  const hex = raw.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (hex.length !== 64) return null;
  const pairs = hex.match(/.{2}/g);
  if (!pairs || pairs.length !== 32) return null;
  return pairs.join(":");
}

function fingerprintsFromEnv(): string[] | null {
  const raw = process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? "";
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const out: string[] = [];
  for (const part of parts) {
    const normalized = normalizeFingerprint(part);
    if (!normalized) return null;
    out.push(normalized);
  }
  return out;
}

export default function handler(req: WellKnownRequest, res: WellKnownResponse): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).end();
    return;
  }
  const fingerprints = fingerprintsFromEnv();
  if (!fingerprints) {
    res.status(404).end();
    return;
  }
  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.skatehubba.app",
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).end(JSON.stringify(body));
}
