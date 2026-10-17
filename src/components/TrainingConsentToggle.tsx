import { useCallback, useEffect, useState } from "react";
import {
  getTrainingConsent,
  isAdultForTraining,
  setTrainingConsent,
  TrainingConsentDeniedError,
} from "../services/trainingConsent";

interface Props {
  uid: string;
}

/**
 * Settings switch. Off unless the skater has opted in, and hidden from
 * anyone under 18 (the control stays visible so they know why it's locked).
 */
export function TrainingConsentToggle({ uid }: Props) {
  const [checked, setChecked] = useState(false);
  const [adult, setAdult] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getTrainingConsent(uid)
      .then((consent) => {
        if (!active) return;
        setChecked(consent.optedIn);
        setAdult(isAdultForTraining(consent.dob));
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setError("Couldn't load this setting.");
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [uid]);

  const onChange = useCallback(
    async (next: boolean) => {
      setError("");
      const previous = checked;
      setChecked(next);
      try {
        await setTrainingConsent(uid, next);
      } catch (err) {
        setChecked(previous);
        setError(err instanceof TrainingConsentDeniedError ? err.message : "Couldn't save that. Try again.");
      }
    },
    [checked, uid],
  );

  return (
    <div className="p-4 rounded-2xl glass-card">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-sm text-white tracking-wide">Help train SkateHubba&apos;s trick AI</p>
          <p className="font-body text-xs text-faint mt-1 leading-snug">
            {adult
              ? "Off unless you turn it on. Clips you film can teach a future trick recognizer. Turn it off anytime and we stop using them, including clips you already shared."
              : "Players under 18 can't opt in."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Help train SkateHubba's trick AI"
          disabled={!ready || !adult}
          onClick={() => void onChange(!checked)}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-all duration-300 ${
              checked
                ? "bg-brand-orange/25 border-brand-orange/60 shadow-[0_0_8px_rgba(255,107,0,0.2)]"
                : "bg-surface-alt border-border"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
                checked ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </span>
        </button>
      </div>
      {error && <p className="font-body text-xs text-brand-red mt-2">{error}</p>}
    </div>
  );
}
