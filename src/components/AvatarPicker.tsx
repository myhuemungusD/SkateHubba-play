import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import {
  ACCEPT,
  GHOST_BTN,
  MENU_BTN,
  SHEET_CLASS,
  captureFromCapacitor,
  type AvatarSource,
  type Pending,
  type Screen,
  isPickerCancel,
} from "./avatarPickerShared";
import { AvatarPreviewScreen } from "./AvatarPreviewScreen";
import { AvatarUrlScreen } from "./AvatarUrlScreen";
import { useSheetFocusTrap } from "./useSheetFocusTrap";

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

  useSheetFocusTrap(sheetRef, onClose);

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
          // Backing out of the native picker rejects too; that's not a failure.
          if (isPickerCancel(err)) return;
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
          // uploadAvatar deletes the previous object before writing the new
          // one. A transport failure here leaves profileImageUrl pointing at a
          // now-deleted object → a broken avatar. Best-effort clear the pointer
          // so the UI falls back to the default skater rather than a 404 image.
          try {
            await setProfileImageUrl(uid, null);
          } catch (clearErr) {
            logger.warn("avatar_pointer_clear_failed", {
              uid,
              error: clearErr instanceof Error ? clearErr.message : String(clearErr),
            });
          }
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

  // Portalled: the profile opens this from a card whose forwards
  // animate-fade-in leaves a transform on it, which would make that card the
  // containing block for `fixed` and squeeze the picker into it.
  return createPortal(
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
          <AvatarUrlScreen
            url={urlInput}
            onUrlChange={setUrlInput}
            errorMsg={errorMsg}
            busy={busy}
            onBack={() => setScreen("menu")}
            onSubmit={handleUrlSubmit}
          />
        )}

        {screen === "preview" && pending && (
          <AvatarPreviewScreen
            previewUrl={pending.previewUrl}
            borderline={borderline}
            errorMsg={errorMsg}
            busy={busy}
            onBack={() => setScreen("menu")}
            onUpload={(acceptBorderline) => void doUpload(acceptBorderline)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
