/**
 * Validation for a Verified-Pro seed (shared by the `proSeed` callable and
 * `scripts/grant-pro.ts`). Dependency-free so the CLI can import it.
 */
const SEED_REASON_MIN = 10;
const SEED_REASON_MAX = 280;
const SEED_COMPANY_MAX = 80;
const SEED_URL_MAX = 500;

export interface SeedInput {
  targetUid: string;
  reason: string;
  evidenceCompany: string;
  evidenceUrl: string;
}

export class SeedInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SeedInputError";
  }
}

function text(raw: unknown, min: number, max: number, code: string): string {
  if (typeof raw !== "string") throw new SeedInputError(code);
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < min || value.length > max) throw new SeedInputError(code);
  return value;
}

/** Bare IPv4 or bracketed IPv6 host: evidence must name a real site, not an address. */
function isIpHost(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

function httpsUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > SEED_URL_MAX) throw new SeedInputError("bad_evidence_url");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SeedInputError("bad_evidence_url");
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || isIpHost(url.hostname)) {
    throw new SeedInputError("bad_evidence_url");
  }
  return url.toString();
}

export function parseSeedInput(data: unknown): SeedInput {
  const body = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const targetUid = body.targetUid;
  if (typeof targetUid !== "string" || targetUid.length === 0 || targetUid.length > 128 || targetUid.includes("/")) {
    throw new SeedInputError("bad_request");
  }
  const evidence = (body.evidence && typeof body.evidence === "object" ? body.evidence : {}) as Record<string, unknown>;
  return {
    targetUid,
    reason: text(body.reason, SEED_REASON_MIN, SEED_REASON_MAX, "bad_reason"),
    evidenceCompany: text(evidence.company, 2, SEED_COMPANY_MAX, "bad_evidence_company"),
    evidenceUrl: httpsUrl(evidence.url),
  };
}
