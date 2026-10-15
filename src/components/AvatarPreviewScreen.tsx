import { GHOST_BTN, PRIMARY_BTN } from "./avatarPickerShared";

interface AvatarPreviewScreenProps {
  previewUrl: string;
  borderline: { score: number } | null;
  errorMsg: string | null;
  busy: boolean;
  onBack: () => void;
  onUpload: (acceptBorderlineNsfw: boolean) => void;
}

/** AvatarPicker's preview step: confirm, or accept a borderline NSFW score. */
export function AvatarPreviewScreen({
  previewUrl,
  borderline,
  errorMsg,
  busy,
  onBack,
  onUpload,
}: AvatarPreviewScreenProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-display text-lg text-white tracking-wide">Preview</h2>
      <div className="mx-auto w-40 h-40 rounded-full overflow-hidden border-2 border-brand-orange/30 shadow-glow-sm bg-surface-alt">
        <img src={previewUrl} alt="Avatar preview" className="w-full h-full object-cover" decoding="async" />
      </div>
      {borderline && (
        <div className="p-3 rounded-xl border border-brand-orange/40 bg-brand-orange/[0.06]">
          <p className="font-display text-sm text-white">This image looks borderline</p>
          <p className="font-body text-xs text-muted mt-1">Are you sure you want to use it as your avatar?</p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={onBack} className={`flex-1 ${GHOST_BTN}`}>
              Pick Another
            </button>
            <button type="button" disabled={busy} onClick={() => onUpload(true)} className={`flex-1 ${PRIMARY_BTN}`}>
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
          <button type="button" onClick={onBack} className={`flex-1 ${GHOST_BTN}`}>
            Back
          </button>
          <button type="button" disabled={busy} onClick={() => onUpload(false)} className={`flex-1 ${PRIMARY_BTN}`}>
            {busy ? "Uploading…" : "Confirm"}
          </button>
        </div>
      )}
    </div>
  );
}
