import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { isClipEditorEnabled } from "../../lib/featureFlags";
import { USER_CLIP_MAX_DURATION_SECONDS } from "../../constants/video";
import { isNativePlatform } from "../../services/nativeVideo";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { Btn } from "../ui/Btn";
import { ErrorBanner } from "../ui/ErrorBanner";
import { CameraIcon, FilmIcon } from "../icons";
import { VideoRecorder } from "../VideoRecorder";
import { UserClipForm } from "./UserClipForm";
import { useUserClipUpload } from "./useUserClipUpload";
import { VIDEO_ACCEPT_ATTR } from "./validation";

// Code-split: the editor (WebGL engine, panels) never touches the entry chunk.
const ClipEditor = lazy(() => import("../ClipEditor/ClipEditor").then((m) => ({ default: m.ClipEditor })));

export interface UserClipUploadModalProps {
  uid: string;
  username: string;
  onClose: () => void;
  /** Fired after the clip doc is written — the feed reloads on this. */
  onPosted: () => void;
  /** Opened from the feed's Edit icon: open the editor as soon as footage is staged. */
  editFirst?: boolean;
}

/**
 * "Post a clip" — the standalone upload flow, reached from the feed header.
 *
 * A modal rather than a screen: posting is a detour from browsing the feed,
 * and the skater expects to land back on the same clip they were watching.
 * Giving it a route would also mean a new `Screen` and a new `<Route>`, which
 * this feature does not need.
 *
 * Three steps, one at a time so the sheet never gets taller than a phone:
 * pick a source → capture/choose → name it and post.
 */
export function UserClipUploadModal({ uid, username, onClose, onPosted, editFirst = false }: UserClipUploadModalProps) {
  const c = useUserClipUpload(uid, username, onPosted);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  useFocusTrap(panelRef);

  // Edit-first entry: the first staged clip goes straight into the editor.
  // Only once, so the clip the editor hands back doesn't reopen it.
  const autoEdited = useRef(false);
  const stagedBlob = c.blob;
  useEffect(() => {
    if (!editFirst || autoEdited.current || !stagedBlob || !isClipEditorEnabled()) return;
    autoEdited.current = true;
    setEditing(true);
  }, [editFirst, stagedBlob]);

  // The file picker is web-only. Inside the Capacitor shell the OS sheet is
  // an inconsistent, permission-heavy detour and the native recorder is right
  // there, so the fork collapses to a single option.
  const native = isNativePlatform();

  const busy = c.submitting || c.checking;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-clip-upload-title"
      onClick={() => {
        if (!busy) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="glass-card max-h-[90vh] w-full max-w-sm animate-scale-in overflow-y-auto rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="user-clip-upload-title" className="mb-1 font-display text-xl text-white">
          {editFirst ? "Edit a clip" : "Post a clip"}
        </h3>
        <p className="mb-4 font-body text-sm text-muted">
          {USER_CLIP_MAX_DURATION_SECONDS} seconds max. Landed tricks only — the feed is for skating.
        </p>

        {c.error && <ErrorBanner message={c.error} onDismiss={c.clearError} />}

        {/* Step 1 — source fork. Skipped entirely once footage is staged. */}
        {c.mode === "choose" && !c.blob && (
          <div className="flex flex-col gap-3">
            <Btn onClick={() => c.chooseMode("record")} variant="primary">
              <CameraIcon size={16} className="-mt-0.5 inline" /> Film It
            </Btn>
            {!native && (
              <Btn onClick={() => fileInputRef.current?.click()} variant="secondary" disabled={c.checking}>
                <FilmIcon size={16} className="-mt-0.5 inline" /> {c.checking ? "Checking..." : "Upload a File"}
              </Btn>
            )}
          </div>
        )}

        {/* Step 2a — in-app capture, at the longer user-clip cap. */}
        {c.mode === "record" && !c.blob && (
          <VideoRecorder
            onRecorded={c.handleRecorded}
            label="Clip"
            doneLabel="Clip recorded"
            maxDurationSeconds={USER_CLIP_MAX_DURATION_SECONDS}
          />
        )}

        {/* Step 3 — review and name. */}
        {c.blob && c.previewUrl && (
          <UserClipForm
            previewUrl={c.previewUrl}
            trickName={c.trickName}
            onTrickNameChange={c.setTrickName}
            onSubmit={() => void c.submit()}
            onDiscard={c.reset}
            submitting={c.submitting}
            canSubmit={c.canSubmit}
            cooldownSeconds={c.cooldownSeconds}
            onEdit={isClipEditorEnabled() ? () => setEditing(true) : undefined}
          />
        )}

        {editing && c.blob && (
          <Suspense fallback={null}>
            <ClipEditor
              blob={c.blob}
              onCancel={() => setEditing(false)}
              onDone={(edited) => {
                setEditing(false);
                c.handleRecorded(edited);
              }}
            />
          </Suspense>
        )}

        {/* Kept mounted across steps so the ref is always live. `hidden`
            rather than conditional rendering: a remount would clear the
            input's value and re-picking the same file would go unnoticed. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={VIDEO_ACCEPT_ATTR}
          hidden
          aria-label="Choose a video file"
          data-testid="user-clip-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            // Clear the input so picking the SAME file after a validation
            // failure still fires `change` (the browser suppresses it when
            // the value is unchanged).
            e.target.value = "";
            void c.handleFilePicked(file);
          }}
        />

        {!c.blob && (
          <div className="mt-4">
            <Btn onClick={onClose} variant="ghost" disabled={busy}>
              Cancel
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
