import { useId } from "react";
import { Btn } from "../ui/Btn";
import { TRICK_NAME_MAX_LENGTH } from "./validation";

export interface UserClipFormProps {
  /** Object URL of the staged clip. */
  previewUrl: string;
  trickName: string;
  onTrickNameChange: (name: string) => void;
  onSubmit: () => void;
  onDiscard: () => void;
  submitting: boolean;
  canSubmit: boolean;
  /** Seconds left on the post cooldown. 0 when the skater may post now. */
  cooldownSeconds: number;
}

/**
 * Second half of the upload flow: the staged clip plays back and gets a name.
 *
 * Split out of the modal so both live inside the 250 LOC component budget,
 * and so the "review what you're about to post" step can be tested without
 * standing up a camera.
 */
export function UserClipForm({
  previewUrl,
  trickName,
  onTrickNameChange,
  onSubmit,
  onDiscard,
  submitting,
  canSubmit,
  cooldownSeconds,
}: UserClipFormProps) {
  const nameId = useId();
  const remaining = TRICK_NAME_MAX_LENGTH - trickName.trim().length;

  return (
    <div className="flex flex-col gap-4">
      <video
        src={previewUrl}
        controls
        playsInline
        aria-label="Your clip"
        className="w-full max-h-[320px] rounded-2xl bg-black object-contain"
      />

      <div>
        <label htmlFor={nameId} className="mb-2 block font-display text-sm tracking-[0.12em] text-dim">
          TRICK
        </label>
        <input
          id={nameId}
          value={trickName}
          onChange={(e) => onTrickNameChange(e.target.value)}
          placeholder="Nollie heelflip"
          // Hard-stop at the cap rather than letting the user type past it and
          // rejecting on submit — the counter below then only ever counts down.
          maxLength={TRICK_NAME_MAX_LENGTH}
          disabled={submitting}
          className="w-full rounded-2xl border border-border bg-surface-alt/80 px-4 py-3.5 font-body text-base text-white backdrop-blur-sm transition-all duration-300 outline-none placeholder:text-subtle/60 focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span className="mt-1 block font-body text-xs text-faint">
          {trickName.trim().length}/{TRICK_NAME_MAX_LENGTH}
          {remaining < 0 ? " — too long" : ""}
        </span>
      </div>

      {/* Cooldown notice. `role="status"` (not alert) — this is a "not yet",
          not a failure, and the clip stays staged the whole time. */}
      {cooldownSeconds > 0 && !submitting && (
        <p role="status" className="font-body text-xs text-faint">
          Please wait {cooldownSeconds}s before uploading another clip.
        </p>
      )}

      <div className="flex gap-3">
        <Btn onClick={onDiscard} variant="secondary" disabled={submitting}>
          Retake
        </Btn>
        <Btn onClick={onSubmit} variant="primary" disabled={!canSubmit}>
          {submitting ? "Posting..." : cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : "Post Clip"}
        </Btn>
      </div>
    </div>
  );
}
