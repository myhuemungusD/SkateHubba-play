import { useEffect, useState } from "react";
import type { UserProfile } from "../services/users";
import {
  getTrainingConsent,
  markTrainingConsentPromptSeen,
  setTrainingConsent,
  shouldPromptTrainingConsent,
  TrainingConsentDeniedError,
} from "../services/trainingConsent";

/**
 * Non-blocking card after a skater's first finished game. Dismissing it
 * writes a seen timestamp so it does not come back. Under-18s never see it.
 */
export function TrainingConsentPrompt({ profile }: { profile: UserProfile }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const gamesPlayed = profile.gamesPlayed ?? (profile.wins ?? 0) + (profile.losses ?? 0);
    getTrainingConsent(profile.uid)
      .then((consent) => {
        if (!active) return;
        setOpen(shouldPromptTrainingConsent(consent, gamesPlayed));
      })
      .catch(() => {
        if (active) setOpen(false);
      });
    return () => {
      active = false;
    };
  }, [profile.uid, profile.gamesPlayed, profile.wins, profile.losses]);

  async function dismiss() {
    setBusy(true);
    try {
      await markTrainingConsentPromptSeen(profile.uid);
      setOpen(false);
    } catch {
      setError("Couldn't save that. You can decide later in Settings.");
      setBusy(false);
    }
  }

  async function optIn() {
    setBusy(true);
    setError("");
    try {
      await setTrainingConsent(profile.uid, true);
      await markTrainingConsentPromptSeen(profile.uid);
      setOpen(false);
    } catch (err) {
      setError(err instanceof TrainingConsentDeniedError ? err.message : "Couldn't save that. Try again in Settings.");
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="mb-6 rounded-2xl border border-brand-orange/40 bg-brand-orange/[0.08] p-4 text-left">
      <p className="font-display text-sm text-white tracking-wide">Help train SkateHubba&apos;s trick AI?</p>
      <p className="font-body text-xs text-faint mt-2 leading-snug">
        This is off unless you say yes. If you opt in, clips you film can be used to teach a future trick recognizer.
        You can turn it off in Settings, and we&apos;ll stop using your clips. Players under 18 can&apos;t opt in.
      </p>
      {error && <p className="font-body text-xs text-brand-red mt-2">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void optIn()}
          className="min-h-11 flex-1 rounded-xl bg-brand-orange/90 font-display text-xs tracking-wider text-black disabled:opacity-40"
        >
          Yes, I&apos;ll help
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void dismiss()}
          className="min-h-11 flex-1 rounded-xl border border-border font-display text-xs tracking-wider text-white disabled:opacity-40"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
