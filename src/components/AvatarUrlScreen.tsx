import { GHOST_BTN, PRIMARY_BTN } from "./avatarPickerShared";

interface AvatarUrlScreenProps {
  url: string;
  onUrlChange: (v: string) => void;
  errorMsg: string | null;
  busy: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

/** AvatarPicker's "Paste image URL" step. */
export function AvatarUrlScreen({ url, onUrlChange, errorMsg, busy, onBack, onSubmit }: AvatarUrlScreenProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-display text-lg text-white tracking-wide">Paste image URL</h2>
      <input
        type="url"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="https://…/avatar.png"
        className="w-full min-h-[44px] px-3 rounded-xl bg-surface-alt border border-border text-white font-body text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      />
      {errorMsg && (
        <p role="alert" className="font-body text-xs text-brand-red">
          {errorMsg}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className={`flex-1 ${GHOST_BTN}`}>
          Back
        </button>
        <button type="button" disabled={busy || !url.trim()} onClick={onSubmit} className={`flex-1 ${PRIMARY_BTN}`}>
          {busy ? "Loading…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
