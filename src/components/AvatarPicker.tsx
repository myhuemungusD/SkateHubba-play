import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  AvatarBorderlineError,
  AvatarRejectedError,
  AvatarTooLargeError,
  AvatarTooSmallError,
  uploadAvatar,
} from "../services/avatars";
import { setProfileImageUrl } from "../services/users";
import { logger } from "../services/logger";
import { analytics } from "../services/analytics";

/**
 * AvatarPicker — bottom-sheet modal for selecting + previewing + uploading
 * a custom avatar. Three sources: Camera, Gallery, Paste URL.
 *
 * Native uses `@capacitor/camera`; web falls back to `<input type="file">`.
 * The crop preview is intentionally minimal for v1 — the upload pipeline
 * resizes to ≤400×400 WebP itself, so a power-user crop UI is a v2
 * audit. Focus-trap is implemented manually per audit D3 (no library).
 */
interface Props {
  uid: string;
  onUploaded: (url: string) => void;
  onClose: () => void;
}

type AvatarSource = "camera" | "gallery" | "url";
type Screen = "menu" | "preview" | "url";

interface Pending {
  blob: Blob;
  source: AvatarSource;
  previewUrl: string;
  originalSizeBytes: number;
}

const ACCEPT = "image/webp,image/jpeg,image/png";
const SHEET_CLASS =
  "fixed inset-x-0 bottom-0 z-50 bg-[#0a0a0a] border-t border-border rounded-t-2xl px-5 pt-5 pb-8 max-h-[80vh] overflow-y-auto motion-safe:animate-slide-up";
const PRIMARY_BTN =
  "min-h-[44px] rounded-xl bg-brand-orange text-white font-display text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
const GHOST_BTN =
  "min-h-[44px] rounded-xl border border-border text-muted font-display text-sm hover:text-white hover:border-border-hover transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
const MENU_BTN =
  "w-full min-h-[44px] py-3 rounded-xl glass-card text-white font-display text-sm hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

/**
 * Capture a Blob from the native Capacitor Camera plugin. Lazy import
 * so the plugin only lands on the upload code path.
 */
async function captureFromCapacitor(source: AvatarSource): Promise<Blob | null> {
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  const photo = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
    promptLabelHeader: "Choose profile picture",
  });
  if (!photo.base64String || !photo.format) return null;
  const bytes = Uint8Array.from(atob(photo.base64String), (c) => c.charCodeAt(0));
  const mime = photo.format === "png" ? "image/png" : photo.format === "webp" ? "image/webp" : "image/jpeg";
  return new Blob([bytes], { type: mime });
}

export function AvatarPicker({ uid, onUploaded, onClose }: Props) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [pending, setPending] = useState<Pending | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [borderline, setBorderline] = useState<{ score: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const releasePending = useCallback((p: Pending | null) => {
    if (p) URL.revokeObjectURL(p.previewUrl);
  }, []);

  // Manual focus-trap (audit D3). Tab loops within the sheet; Escape closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    sheetRef.current?.querySelector<HTMLElement>("button,a,input")?.focus();
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBlob = useCallback(
    (blob: Blob, source: AvatarSource) => {
      releasePending(pending);
      const previewUrl = URL.createObjectURL(blob);
      setPending({ blob, source, previewUrl, originalSizeBytes: blob.size });
      setBorderline(null);
      setErrorMsg(null);
      setScreen("preview");
    },
    [pending, releasePending],
  );

  const triggerFileInput = useCallback(
    async (source: AvatarSource) => {
      if (Capacitor.isNativePlatform()) {
        try {
          const blob = await captureFromCapacitor(source);
          if (blob) handleBlob(blob, source);
        } catch (err) {
          logger.warn("avatar_picker_native_failed", {
            source,
            error: err instanceof Error ? err.message : String(err),
          });
          setErrorMsg(
            source === "camera"
              ? "Camera access denied. Check your device settings."
              : "Photo library access denied. Check your device settings.",
          );
        }
        return;
      }
      const input = source === "camera" ? cameraInputRef.current : galleryInputRef.current;
      input?.click();
    },
    [handleBlob],
  );

  const onFileChange = useCallback(
    (source: AvatarSource) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) handleBlob(f, source);
    },
    [handleBlob],
  );

  const doUpload = useCallback(
    async (acceptBorderlineNsfw: boolean) => {
      if (!pending) return;
      setBusy(true);
      setErrorMsg(null);
      const start = Date.now();
      analytics.avatarUploadStarted(pending.source, pending.originalSizeBytes);
      try {
        const url = await uploadAvatar(uid, pending.blob, { acceptBorderlineNsfw });
        await setProfileImageUrl(uid, url);
        analytics.avatarUploadCompleted(uid, pending.blob.size, Date.now() - start);
        releasePending(pending);
        onUploaded(url);
      } catch (err) {
        if (err instanceof AvatarBorderlineError) {
          setBorderline({ score: err.score });
          analytics.avatarUploadFailed("borderline", pending.source, err.score);
        } else if (err instanceof AvatarRejectedError) {
          setErrorMsg("Image not allowed.");
          analytics.avatarUploadFailed("nsfw", pending.source, err.score);
        } else if (err instanceof AvatarTooLargeError) {
          setErrorMsg("Image too large after compression. Try a different photo.");
          analytics.avatarUploadFailed("too_large", pending.source);
        } else if (err instanceof AvatarTooSmallError) {
          setErrorMsg("Image too small. Try a different photo.");
          analytics.avatarUploadFailed("too_small", pending.source);
        } else {
          logger.warn("avatar_upload_failed", {
            uid,
            source: pending.source,
            error: err instanceof Error ? err.message : String(err),
          });
          analytics.avatarUploadFailed("transport", pending.source);
          setErrorMsg("Upload failed. Check your connection and try again.");
        }
      } finally {
        setBusy(false);
      }
    },
    [pending, uid, onUploaded, releasePending],
  );

  const handleUrlSubmit = useCallback(async () => {
    setErrorMsg(null);
    // Reject non-http(s) schemes up-front so we never hand `file://`,
    // `data:`, or `javascript:` URLs to fetch (audit B-ISSUE-1).
    if (!/^https?:\/\//i.test(urlInput.trim())) {
      setErrorMsg("Only http:// and https:// URLs are supported.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(urlInput, { mode: "cors" });
      if (!res.ok) throw new Error(`fetch_${res.status}`);
      handleBlob(await res.blob(), "url");
    } catch (err) {
      logger.warn("avatar_picker_url_fetch_failed", { error: err instanceof Error ? err.message : String(err) });
      setErrorMsg("Couldn't fetch that URL. Try a different image.");
    } finally {
      setBusy(false);
    }
  }, [urlInput, handleBlob]);

  const close = useCallback(() => {
    releasePending(pending);
    onClose();
  }, [onClose, pending, releasePending]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Choose profile picture" className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close avatar picker"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
        onClick={close}
        tabIndex={-1}
      />
      <div ref={sheetRef} className={SHEET_CLASS}>
        {screen === "menu" && (
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg text-white tracking-wide">Choose profile picture</h2>
            {errorMsg && (
              <p role="alert" className="font-body text-xs text-brand-red">
                {errorMsg}
              </p>
            )}
            <button type="button" onClick={() => triggerFileInput("camera")} className={MENU_BTN}>
              Take Photo
            </button>
            <button type="button" onClick={() => triggerFileInput("gallery")} className={MENU_BTN}>
              Choose From Gallery
            </button>
            <button type="button" onClick={() => setScreen("url")} className={MENU_BTN}>
              Paste Image URL
            </button>
            <button type="button" onClick={close} className={`w-full py-3 ${GHOST_BTN}`}>
              Cancel
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept={ACCEPT}
              capture="user"
              onChange={onFileChange("camera")}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept={ACCEPT}
              onChange={onFileChange("gallery")}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
        )}

        {screen === "url" && (
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg text-white tracking-wide">Paste image URL</h2>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://…/avatar.png"
              className="w-full min-h-[44px] px-3 rounded-xl bg-surface-alt border border-border text-white font-body text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            />
            {errorMsg && (
              <p role="alert" className="font-body text-xs text-brand-red">
                {errorMsg}
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setScreen("menu")} className={`flex-1 ${GHOST_BTN}`}>
                Back
              </button>
              <button
                type="button"
                disabled={busy || !urlInput.trim()}
                onClick={handleUrlSubmit}
                className={`flex-1 ${PRIMARY_BTN}`}
              >
                {busy ? "Loading…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {screen === "preview" && pending && (
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg text-white tracking-wide">Preview</h2>
            <div className="mx-auto w-40 h-40 rounded-full overflow-hidden border-2 border-brand-orange/30 shadow-glow-sm bg-surface-alt">
              <img
                src={pending.previewUrl}
                alt="Avatar preview"
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
            {borderline && (
              <div className="p-3 rounded-xl border border-brand-orange/40 bg-brand-orange/[0.06]">
                <p className="font-display text-sm text-white">This image looks borderline</p>
                <p className="font-body text-xs text-muted mt-1">Are you sure you want to use it as your avatar?</p>
                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={() => setScreen("menu")} className={`flex-1 ${GHOST_BTN}`}>
                    Pick Another
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => doUpload(true)}
                    className={`flex-1 ${PRIMARY_BTN}`}
                  >
                    {busy ? "Uploading…" : "Use Anyway"}
                  </button>
                </div>
              </div>
            )}
            {errorMsg && (
              <p role="alert" className="font-body text-xs text-brand-red">
                {errorMsg}
              </p>
            )}
            {!borderline && (
              <div className="flex gap-2">
                <button type="button" onClick={() => setScreen("menu")} className={`flex-1 ${GHOST_BTN}`}>
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doUpload(false)}
                  className={`flex-1 ${PRIMARY_BTN}`}
                >
                  {busy ? "Uploading…" : "Confirm"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
