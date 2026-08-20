/**
 * State + write orchestration for posting a standalone clip to the feed.
 *
 * Mirrors the `useClipsFeedController` pattern: every piece of state and each
 * async handler lives here, the modal is pure JSX. The two-step write
 * (Storage first, then Firestore) is the reason this is a hook and not a form
 * — the intermediate states are what the UI is mostly rendering.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipCooldownError, createUserClip, newUserClipId, UserBannedError } from "../../services/clips.userWrites";
import { uploadUserClip } from "../../services/storage";
import { trackEvent } from "../../services/analytics";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { probeVideoDuration, validateTrickName, validateVideoDuration, validateVideoFile } from "./validation";

/**
 * How the skater is supplying the footage.
 *  • `choose` — the fork: film now, or pick an existing file.
 *  • `record` — the in-app one-take recorder (the only option on native,
 *               where there is no meaningful file picker).
 *  • `file`   — a video already on the device.
 */
export type UploadMode = "choose" | "record" | "file";

/**
 * Minimum gap between two user-clip creates, mirroring the Firestore rule.
 *
 * The rule is the enforcement; this is the client's copy so a skater posting
 * a second clip is stopped BEFORE the upload rather than after it. That
 * ordering is the whole point: the create is the last step, so a reactive
 * "you're too fast" would arrive only after 30 MB had already gone over the
 * wire and been paid for.
 */
export const USER_CLIP_COOLDOWN_MS = 30_000;

/**
 * When this session last posted a clip. Module-scoped, not component state,
 * because the modal UNMOUNTS on a successful post — the one moment the
 * cooldown starts. Held in memory only: a reload or a second device falls
 * back to the rules rejection, which is why the rule is the real boundary.
 */
let lastPostedAt = 0;

/** Milliseconds left on the cooldown, or 0 when clear. */
function cooldownRemainingMs(now: number): number {
  return Math.max(0, lastPostedAt + USER_CLIP_COOLDOWN_MS - now);
}

/** Test seam — resets the module-scoped cooldown between cases. */
export function _resetUserClipCooldown(): void {
  lastPostedAt = 0;
}

export interface UserClipUploadController {
  mode: UploadMode;
  chooseMode: (mode: UploadMode) => void;
  /** Back to the fork, discarding whatever footage was staged. */
  reset: () => void;
  /** The staged clip, or null before one has been captured/picked. */
  blob: Blob | null;
  /** Object URL for previewing `blob`. Null when nothing is staged. */
  previewUrl: string | null;
  trickName: string;
  setTrickName: (name: string) => void;
  /** Result of the finished recorder take. */
  handleRecorded: (blob: Blob | null) => void;
  /** Validate + stage a file from the picker. */
  handleFilePicked: (file: File | null) => Promise<void>;
  submit: () => Promise<void>;
  /** True while the file is being validated (duration probe). */
  checking: boolean;
  /** True from the moment submit starts until it settles. */
  submitting: boolean;
  error: string;
  clearError: () => void;
  /** True when `submit` would be accepted — drives the POST button. */
  canSubmit: boolean;
  /** Whole seconds left before another clip may be posted. 0 when clear. */
  cooldownSeconds: number;
}

export function useUserClipUpload(
  uid: string,
  username: string,
  onPosted: () => void,
  spotId: string | null = null,
): UserClipUploadController {
  const [mode, setMode] = useState<UploadMode>("choose");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [trickName, setTrickName] = useState("");
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Guard setState-after-unmount: both the duration probe and the two-step
  // write outlive a modal the user can close at any point.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Own the preview object URL's lifetime. Revoking the previous one on every
  // swap (and on unmount) is what stops a skater who re-picks four files from
  // pinning four videos in memory for the life of the tab.
  const previewUrlRef = useRef<string | null>(null);
  const setPreview = useCallback((next: Blob | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next ? URL.createObjectURL(next) : null;
    setPreviewUrl(previewUrlRef.current);
  }, []);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    },
    [],
  );

  // Tick the cooldown down while the modal is open so the POST button
  // re-enables on its own — an operator who has to guess when to retry will
  // just mash the button and collect rejections.
  const [cooldownMs, setCooldownMs] = useState(() => cooldownRemainingMs(Date.now()));
  useEffect(() => {
    if (cooldownMs <= 0) return;
    const id = setInterval(() => setCooldownMs(cooldownRemainingMs(Date.now())), 1000);
    return () => clearInterval(id);
  }, [cooldownMs]);
  const cooldownSeconds = Math.ceil(cooldownMs / 1000);

  const clearError = useCallback(() => setError(""), []);

  const chooseMode = useCallback((next: UploadMode) => {
    setError("");
    setMode(next);
  }, []);

  const reset = useCallback(() => {
    setBlob(null);
    setPreview(null);
    setError("");
    setMode("choose");
  }, [setPreview]);

  const handleRecorded = useCallback(
    (recorded: Blob | null) => {
      if (!recorded) {
        // The recorder reports null when the take produced no usable bytes.
        // It has already surfaced its own camera-level message; this is the
        // "you have nothing staged" half of that story.
        setError("That take didn't record. Try again.");
        return;
      }
      setError("");
      setBlob(recorded);
      setPreview(recorded);
    },
    [setPreview],
  );

  const handleFilePicked = useCallback(
    async (file: File | null): Promise<void> => {
      if (!file) return;
      setError("");
      const shapeError = validateVideoFile(file);
      if (shapeError) {
        setError(shapeError);
        return;
      }
      setChecking(true);
      try {
        const seconds = await probeVideoDuration(file);
        if (!mountedRef.current) return;
        const durationError = validateVideoDuration(seconds);
        if (durationError) {
          setError(durationError);
          return;
        }
        setBlob(file);
        setPreview(file);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Couldn't read that video. Try a different file.");
      } finally {
        if (mountedRef.current) setChecking(false);
      }
    },
    [setPreview],
  );

  const canSubmit =
    blob !== null && validateTrickName(trickName) === null && !submitting && !checking && cooldownMs <= 0;

  const submit = useCallback(async (): Promise<void> => {
    if (!blob) {
      setError("Record or pick a clip first.");
      return;
    }
    const nameError = validateTrickName(trickName);
    if (nameError) {
      setError(nameError);
      return;
    }
    // Pre-empt the rules rejection. Checked against the clock rather than the
    // ticking state so a stale render can't wave a too-early post through.
    const waitMs = cooldownRemainingMs(Date.now());
    if (waitMs > 0) {
      setCooldownMs(waitMs);
      setError(`Please wait ${Math.ceil(waitMs / 1000)}s before uploading another clip.`);
      return;
    }
    setSubmitting(true);
    setError("");
    // The id is minted before the upload because the Storage path embeds it.
    // See `newUserClipId` — abandoning an unused id costs nothing.
    const clipId = newUserClipId();
    try {
      // Storage first: a clip doc pointing at an object that failed to upload
      // is a broken tile in the feed, whereas an orphaned Storage object is
      // invisible and swept by the storage lifecycle rule.
      const videoUrl = await uploadUserClip(uid, clipId, blob);
      // `playerUid` is not a parameter — the service pins it to the signed-in
      // user because the create rule does.
      await createUserClip({
        clipId,
        playerUsername: username,
        trickName: trickName.trim(),
        videoUrl,
        spotId,
      });
      // Start the cooldown from the ACCEPTED write, not from the tap: the
      // upload can take a while, and anchoring earlier would let the client
      // clear before the rule does.
      lastPostedAt = Date.now();
      trackEvent("user_clip_posted", { clipId });
      if (!mountedRef.current) return;
      onPosted();
    } catch (err) {
      logger.warn("user_clip_post_failed", { clipId, error: parseFirebaseError(err) });
      if (!mountedRef.current) return;
      // The service's typed refusals carry machine-readable messages
      // ("clip_cooldown:12000", "user_banned") meant to be branched on, not
      // shown. Each gets its own copy here; everything else keeps the
      // service's already user-facing message.
      if (err instanceof ClipCooldownError) {
        // The server's anchor is authoritative and can be ahead of ours (a
        // reload, or a post from another device, clears the module-scoped
        // copy). Back-date `lastPostedAt` so the ticking countdown and
        // `canSubmit` agree with the rule instead of clearing a second later.
        lastPostedAt = Date.now() - (USER_CLIP_COOLDOWN_MS - err.retryAfterMs);
        setCooldownMs(err.retryAfterMs);
        setError(`Please wait ${Math.ceil(err.retryAfterMs / 1000)}s before uploading another clip.`);
        return;
      }
      if (err instanceof UserBannedError) {
        setError("Your account can't post clips. Contact support if you think this is a mistake.");
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't post that clip. Try again.");
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }, [blob, trickName, uid, username, spotId, onPosted]);

  return {
    mode,
    chooseMode,
    reset,
    blob,
    previewUrl,
    trickName,
    setTrickName,
    handleRecorded,
    handleFilePicked,
    submit,
    checking,
    submitting,
    error,
    clearError,
    canSubmit,
    cooldownSeconds,
  };
}
