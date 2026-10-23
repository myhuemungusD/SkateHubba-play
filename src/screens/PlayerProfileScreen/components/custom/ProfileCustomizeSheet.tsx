import { useRef, useState } from "react";
import { useFocusTrap } from "../../../../hooks/useFocusTrap";
import { X } from "lucide-react";
import { gradientCss, saveProfileCustom, type ProfileCustom } from "../../../../services/profileCustom";
import { CustomizeAboutTab } from "./CustomizeAboutTab";
import { CustomizeLayoutTab } from "./CustomizeLayoutTab";
import { CustomizeLookTab } from "./CustomizeLookTab";

type Tab = "look" | "layout" | "about";

interface Props {
  uid: string;
  initial: ProfileCustom;
  onClose: () => void;
  onSaved: (next: ProfileCustom) => void;
}

/**
 * Full-screen profile editor (VITE_FEATURE_PROFILE_CUSTOM). Three tabs keep
 * it uncluttered: Look (colors, gradient, banner crop), Layout (section
 * order, pins, showcase) and About (bio, tricks, links, sponsors, song).
 * Live preview strip at the top; nothing saves until Save.
 */
export function ProfileCustomizeSheet({ uid, initial, onClose, onSaved }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Escape closes. No swipe-down here: the sheet has reorder controls and
  // unsaved edits, so a stray vertical drag must not discard them.
  useFocusTrap(sheetRef, true, onClose);
  const [draft, setDraft] = useState<ProfileCustom>(initial);
  const [tab, setTab] = useState<Tab>("look");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof ProfileCustom>(k: K, v: ProfileCustom[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await saveProfileCustom(uid, draft));
      onClose();
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label="Customize profile"
      data-testid="profile-customize-sheet"
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
    >
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <button type="button" aria-label="Close" onClick={onClose} className="min-h-[44px] min-w-[44px] text-white/80">
          <X size={20} />
        </button>
        <h2 className="font-display text-sm tracking-wider text-white">CUSTOMIZE</h2>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="min-h-[44px] px-3 font-display text-sm tracking-wider disabled:opacity-50"
          style={{ color: draft.accent }}
        >
          {saving ? "SAVING" : "SAVE"}
        </button>
      </div>

      <div
        data-testid="customize-preview"
        className="mx-4 mb-3 h-16 rounded-xl border border-white/10"
        style={{ background: gradientCss(draft), boxShadow: `inset 0 -3px 0 ${draft.accent}` }}
      />

      <div role="tablist" className="mx-4 mb-3 grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">
        {(["look", "layout", "about"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-[36px] rounded-lg font-display text-sm tracking-wider ${tab === t ? "bg-white/15 text-white" : "text-white/60"}`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {error && (
          <p role="alert" className="mb-3 font-body text-xs text-red-400">
            {error}
          </p>
        )}

        {tab === "look" && <CustomizeLookTab draft={draft} set={set} />}
        {tab === "layout" && <CustomizeLayoutTab uid={uid} draft={draft} set={set} />}
        {tab === "about" && <CustomizeAboutTab draft={draft} set={set} />}
      </div>
    </div>
  );
}
