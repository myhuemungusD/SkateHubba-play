import { VIDEO_API_POLL_MS, VIDEO_API_TIMEOUT_MS } from "./config.js";
import type { LabelHit, VideoAnnotation } from "./decide.js";

const ANNOTATE_URL = "https://videointelligence.googleapis.com/v1/videos:annotate";
const TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export class VideoIntelligenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoIntelligenceError";
  }
}

interface AnnotateDeps {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string>;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Access token from the Cloud Functions metadata server. */
export async function gcpAccessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) throw new VideoIntelligenceError(`metadata token ${res.status}`);
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new VideoIntelligenceError("metadata token missing");
  }
  return body.access_token;
}

function labelsFrom(raw: unknown): LabelHit[] {
  if (!Array.isArray(raw)) return [];
  const hits: LabelHit[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { entity?: { description?: unknown }; segments?: unknown; frames?: unknown };
    const description = row.entity?.description;
    if (typeof description !== "string" || description.length === 0) continue;
    const confidence = maxConfidence(row.segments) ?? maxConfidence(row.frames) ?? 0;
    hits.push({ description, confidence });
  }
  return hits;
}

function maxConfidence(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  let best: number | null = null;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const confidence = (entry as { confidence?: unknown }).confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    if (best === null || confidence > best) best = confidence;
  }
  return best;
}

/** Pull explicit-content likelihoods and labels out of an annotate response. */
export function parseAnnotationResponse(body: unknown): VideoAnnotation {
  const results = annotationResults(body);
  const explicitLikelihoods: string[] = [];
  const labels: LabelHit[] = [];
  for (const result of results) {
    const frames = result.explicitAnnotation?.frames;
    if (Array.isArray(frames)) {
      for (const frame of frames) {
        if (!frame || typeof frame !== "object") continue;
        const likelihood = (frame as { pornographyLikelihood?: unknown }).pornographyLikelihood;
        if (typeof likelihood === "string") explicitLikelihoods.push(likelihood);
      }
    }
    labels.push(
      ...labelsFrom(result.segmentLabelAnnotations),
      ...labelsFrom(result.shotLabelAnnotations),
      ...labelsFrom(result.frameLabelAnnotations),
    );
  }
  return { explicitLikelihoods, labels };
}

interface AnnotationResult {
  explicitAnnotation?: { frames?: unknown };
  segmentLabelAnnotations?: unknown;
  shotLabelAnnotations?: unknown;
  frameLabelAnnotations?: unknown;
}

function annotationResults(body: unknown): AnnotationResult[] {
  if (!body || typeof body !== "object") return [];
  const response = (body as { response?: { annotationResults?: unknown } }).response;
  const results = response?.annotationResults;
  if (!Array.isArray(results)) return [];
  return results.filter((row): row is AnnotationResult => !!row && typeof row === "object");
}

/**
 * Run explicit-content detection and label detection on a stored video.
 * Throws {@link VideoIntelligenceError} on HTTP failure or timeout. Callers
 * must treat that as "send to review", never as approval.
 */
export async function annotateStoredVideo(gcsUri: string, deps: AnnotateDeps = {}): Promise<VideoAnnotation> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const getToken = deps.getToken ?? (() => gcpAccessToken(fetchImpl));
  const timeoutMs = deps.timeoutMs ?? VIDEO_API_TIMEOUT_MS;
  const pollMs = deps.pollMs ?? VIDEO_API_POLL_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const started = now();
  const token = await getToken();
  const created = await fetchImpl(ANNOTATE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputUri: gcsUri,
      features: ["EXPLICIT_CONTENT_DETECTION", "LABEL_DETECTION"],
    }),
  });
  if (!created.ok) throw new VideoIntelligenceError(`annotate ${created.status}`);
  const createdBody = (await created.json()) as { name?: unknown };
  if (typeof createdBody.name !== "string" || createdBody.name.length === 0) {
    throw new VideoIntelligenceError("annotate operation missing");
  }
  const operationUrl = `https://videointelligence.googleapis.com/v1/${createdBody.name}`;
  for (;;) {
    if (now() - started > timeoutMs) throw new VideoIntelligenceError("video intelligence timed out");
    const polled = await fetchImpl(operationUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!polled.ok) throw new VideoIntelligenceError(`operation ${polled.status}`);
    const operation = (await polled.json()) as { done?: unknown; error?: { message?: unknown } };
    if (operation.done === true) {
      if (operation.error) {
        const message = operation.error.message;
        throw new VideoIntelligenceError(typeof message === "string" ? message : "video intelligence failed");
      }
      return parseAnnotationResponse(operation);
    }
    await sleep(pollMs);
  }
}
