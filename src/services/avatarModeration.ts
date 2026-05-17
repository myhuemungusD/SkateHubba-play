/**
 * On-device avatar NSFW screening.
 *
 * Runs the user's avatar through `nsfwjs` (TensorFlow.js) entirely client-
 * side before upload — no third-party API, no per-upload cost, no PII
 * leaving the device. The model weights (~10 MB) are lazy-loaded the
 * first time `isAvatarSafe` is called and cached for the rest of the
 * session.
 *
 * Storage rules are still the canonical defence (defense in depth) — if
 * the model load fails for any reason we fail OPEN here so the upload
 * flow doesn't break for users on flaky networks. The rules will reject
 * the upload server-side if the file is malformed; the in-app moderation
 * is a UX/cost optimisation, not a security boundary.
 *
 * Score thresholds (see {@link AvatarSafetyResult}):
 *   - >0.85 → reject (`ok: false`)
 *   - 0.5..0.85 → allow with `category` populated so the caller can warn
 *   - <0.5 → allow silently
 */

/** Outcome of `isAvatarSafe`. Score is the maximum unsafe-class probability. */
export interface AvatarSafetyResult {
  /** False if the image should be rejected outright. */
  ok: boolean;
  /** Highest unsafe-class probability in [0, 1]. */
  score: number;
  /** Populated when score sits in the warn-band; the offending class name. */
  category?: string;
}

/** NSFWjs prediction shape — kept narrow on purpose so the import is light. */
interface NsfwPrediction {
  className: string;
  probability: number;
}

interface NsfwModel {
  classify(image: HTMLImageElement | HTMLCanvasElement | ImageBitmap): Promise<NsfwPrediction[]>;
}

interface NsfwModule {
  load(modelUrl?: string): Promise<NsfwModel>;
}

/** Reject above this score. Tuned conservatively — false positives are
 *  better than letting genuinely unsafe avatars through. */
const REJECT_THRESHOLD = 0.85;
/** Warn-band lower bound. Below this, we say nothing. */
const WARN_THRESHOLD = 0.5;

/** Class names that count as unsafe for avatar use. */
const UNSAFE_CLASSES = new Set(["Porn", "Hentai", "Sexy"]);

/** Cached model instance — loaded once per session. */
let modelPromise: Promise<NsfwModel | null> | null = null;

/**
 * Lazy-load the NSFWjs model. The dynamic import keeps `nsfwjs` and its
 * TensorFlow.js dependency out of the main bundle entirely — chunk only
 * lands when an avatar upload code path runs `isAvatarSafe`.
 */
async function loadModel(): Promise<NsfwModel | null> {
  try {
    const mod = (await import("nsfwjs")) as unknown as NsfwModule;
    return await mod.load();
  } catch (err) {
    // Fail-open: storage rules + the size/MIME pre-checks are the real
    // boundary. Surface the failure to ops without breaking the user.
    console.warn("[avatarModeration] model_load_failed", err);
    return null;
  }
}

/**
 * Decode a Blob into something NSFWjs can classify. Uses the browser's
 * native image decoder via an Object URL → HTMLImageElement bridge so we
 * don't pull in another dependency.
 */
async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("avatar_decode_failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Run NSFW screening on an avatar blob. Always resolves — never throws —
 * because callers shouldn't have to wrap their UI in try/catch. A model
 * load failure resolves with `{ ok: true, score: 0 }` (fail-open).
 */
export async function isAvatarSafe(blob: Blob): Promise<AvatarSafetyResult> {
  if (!modelPromise) {
    modelPromise = loadModel();
  }
  const model = await modelPromise;
  if (!model) {
    // Reset so the next call retries — load failures are often transient.
    modelPromise = null;
    return { ok: true, score: 0 };
  }

  let img: HTMLImageElement;
  try {
    img = await decodeImage(blob);
  } catch (err) {
    console.warn("[avatarModeration] decode_failed", err);
    return { ok: true, score: 0 };
  }

  let predictions: NsfwPrediction[];
  try {
    predictions = await model.classify(img);
  } catch (err) {
    console.warn("[avatarModeration] classify_failed", err);
    return { ok: true, score: 0 };
  }

  let topScore = 0;
  let topCategory: string | undefined;
  for (const p of predictions) {
    if (UNSAFE_CLASSES.has(p.className) && p.probability > topScore) {
      topScore = p.probability;
      topCategory = p.className;
    }
  }

  if (topScore > REJECT_THRESHOLD) {
    return { ok: false, score: topScore, category: topCategory };
  }
  if (topScore >= WARN_THRESHOLD) {
    return { ok: true, score: topScore, category: topCategory };
  }
  return { ok: true, score: topScore };
}

/** @internal exported for tests — clears the cached model promise. */
export function __resetAvatarModerationForTests(): void {
  modelPromise = null;
}
