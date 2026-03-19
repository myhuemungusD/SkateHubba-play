import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { createProfile, isUsernameAvailable, type UserProfile } from "../services/users";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { SkateboardIcon } from "../components/icons";

type Step = 1 | 2 | 3;

const STANCES = [
  { value: "Regular", foot: "Left foot forward" },
  { value: "Goofy", foot: "Right foot forward" },
] as const;

const DEBOUNCE_MS = 400;
const USERNAME_RE = /^[a-z0-9_]+$/;
const SANITIZE_RE = /[^a-z0-9_]/g;

/* ── Shared ───────────────────────────────────────────────────── */

function StepHeader({ step, title, subtitle }: { step: Step; title: string; subtitle: string }) {
  return (
    <>
      <span className="font-display text-xs tracking-[0.3em] text-brand-orange block mb-2">STEP {step} OF 3</span>
      <h2 className="font-display text-3xl text-white mb-1">{title}</h2>
      <p className="font-body text-sm text-[#888] mb-7">{subtitle}</p>
    </>
  );
}

function LoadingSpinner({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      {children}
    </span>
  );
}

function ProgressBar({ step }: { step: Step }) {
  return (
    <div
      className="flex items-center gap-2 mb-8"
      role="progressbar"
      aria-valuenow={step}
      aria-valuemin={1}
      aria-valuemax={3}
      aria-label={`Step ${step} of 3`}
    >
      {[1, 2, 3].map((s) => (
        <div
          key={s}
          className={`h-1 flex-1 rounded-full transition-all duration-500 ${
            s <= step ? "bg-brand-orange" : "bg-[#2A2A2A]"
          }`}
        />
      ))}
    </div>
  );
}

function NavButtons({
  onBack,
  onForward,
  forwardLabel,
  forwardDisabled,
  loading,
}: {
  onBack: () => void;
  onForward: () => void;
  forwardLabel: ReactNode;
  forwardDisabled?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <Btn variant="ghost" onClick={onBack} disabled={loading} className="flex-1">
        Back
      </Btn>
      <Btn onClick={onForward} disabled={forwardDisabled} className="flex-[2]">
        {forwardLabel}
      </Btn>
    </div>
  );
}

/* ── Step 1: Username ─────────────────────────────────────────── */

function usernameNote(name: string, available: boolean | null): string {
  if (name.length < 3) return "Min 3 characters, letters/numbers/underscore";
  if (available === null) return "Checking...";
  const handle = `@${name}`;
  return available ? `${handle} is available ✓` : `${handle} is taken ✗`;
}

function StepUsername({
  username,
  setUsername,
  available,
  loading,
  onNext,
  error,
  onClearError,
}: {
  username: string;
  setUsername: (v: string) => void;
  available: boolean | null;
  loading: boolean;
  onNext: () => void;
  error: string;
  onClearError: () => void;
}) {
  const canProceed = username.length >= 3 && available === true && !loading;

  return (
    <div className="animate-step-in">
      <StepHeader
        step={1}
        title="Pick your handle"
        subtitle="This is how the crew knows you. Choose wisely — it can't be changed."
      />

      <Field
        label="Username"
        value={username}
        onChange={(v) => {
          if (!loading) setUsername(v.toLowerCase().replace(SANITIZE_RE, ""));
        }}
        placeholder="sk8legend"
        maxLength={20}
        icon="@"
        autoComplete="username"
        autoFocus
        note={usernameNote(username, available)}
      />

      {username.length >= 3 && available !== null && (
        <div
          className={`flex items-center gap-2 -mt-2 mb-5 px-1 transition-all duration-300 ${
            available ? "text-brand-green" : "text-brand-red"
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${available ? "bg-brand-green" : "bg-brand-red"}`} />
          <span className="font-body text-xs">{available ? "You're good to go" : "Try another name"}</span>
        </div>
      )}

      <ErrorBanner message={error} onDismiss={onClearError} />

      <Btn onClick={onNext} disabled={!canProceed}>
        {loading ? <LoadingSpinner>Checking...</LoadingSpinner> : "Next"}
      </Btn>
    </div>
  );
}

/* ── Step 2: Stance ───────────────────────────────────────────── */

function StepStance({
  stance,
  setStance,
  onNext,
  onBack,
}: {
  stance: string;
  setStance: (s: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="animate-step-in">
      <StepHeader
        step={2}
        title="What's your stance?"
        subtitle="Regular or Goofy — no wrong answer, just your lead foot."
      />

      <div className="flex gap-3 mb-8" role="radiogroup" aria-label="Skating stance">
        {STANCES.map(({ value, foot }) => {
          const selected = stance === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setStance(value)}
              className={`flex-1 py-5 rounded-2xl font-display text-lg tracking-wider cursor-pointer transition-all duration-200 ${
                selected
                  ? "bg-[rgba(255,107,0,0.1)] border-2 border-brand-orange text-brand-orange scale-[1.02] shadow-[0_0_20px_rgba(255,107,0,0.15)]"
                  : "bg-surface-alt border-2 border-border text-[#666] hover:border-[#3A3A3A] hover:text-[#888]"
              }`}
            >
              <div className="flex justify-center mb-2" aria-hidden="true">
                <SkateboardIcon size={28} className={selected ? "text-brand-orange" : "text-[#666]"} />
              </div>
              <div>{value}</div>
              <div className="font-body text-[10px] text-[#555] mt-1 tracking-normal">{foot}</div>
            </button>
          );
        })}
      </div>

      <NavButtons onBack={onBack} onForward={onNext} forwardLabel="Next" />
    </div>
  );
}

/* ── Step 3: Review ───────────────────────────────────────────── */

function StepReview({
  username,
  stance,
  loading,
  error,
  onSubmit,
  onBack,
}: {
  username: string;
  stance: string;
  loading: boolean;
  error: string;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="animate-step-in">
      <StepHeader step={3} title="Looking good" subtitle="Double-check your profile before locking it in." />

      <div className="bg-surface-alt border border-border rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-full bg-[rgba(255,107,0,0.12)] border-2 border-brand-orange flex items-center justify-center">
            <span className="font-display text-2xl text-brand-orange">{username[0].toUpperCase()}</span>
          </div>
          <div>
            <div className="font-display text-xl text-white tracking-wide">@{username}</div>
            <div className="font-body text-xs text-[#666]">Ready to skate</div>
          </div>
        </div>

        <div className="flex gap-4">
          {[
            { label: "Stance", value: stance },
            { label: "Record", value: "0 – 0" },
          ].map(({ label, value }) => (
            <div key={label} className="flex-1 bg-[#0A0A0A] rounded-xl p-3 text-center">
              <div className="font-body text-[10px] text-[#555] uppercase tracking-wider mb-1">{label}</div>
              <div className="font-display text-lg text-white">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <ErrorBanner message={error} />

      <NavButtons
        onBack={onBack}
        onForward={onSubmit}
        forwardLabel={loading ? <LoadingSpinner>Creating...</LoadingSpinner> : "Lock It In"}
        forwardDisabled={loading}
        loading={loading}
      />
    </div>
  );
}

/* ── Main ProfileSetup ────────────────────────────────────────── */

function sanitizeDisplayName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(SANITIZE_RE, "").slice(0, 20);
}

export function ProfileSetup({
  uid,
  emailVerified = false,
  displayName,
  onDone,
}: {
  uid: string;
  emailVerified?: boolean;
  displayName?: string | null;
  onDone: (p: UserProfile) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [username, setUsername] = useState(() => sanitizeDisplayName(displayName));
  const [stance, setStance] = useState("Regular");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const checkRef = useRef(0);

  useEffect(() => {
    setAvailable(null);
    const normalized = username.trim();
    if (normalized.length < 3) return;

    const id = ++checkRef.current;
    const timeout = setTimeout(async () => {
      try {
        const ok = await isUsernameAvailable(normalized);
        /* v8 ignore start */
        if (checkRef.current === id) setAvailable(ok);
        /* v8 ignore stop */
      } catch {
        /* v8 ignore start */
        if (checkRef.current === id) setAvailable(null);
        /* v8 ignore stop */
        setError("Could not check username — try again");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [username]);

  const goNext = useCallback(() => {
    setError("");
    if (step === 1) {
      const normalized = username.trim();
      if (normalized.length < 3) {
        setError("Username must be 3+ characters");
        return;
      }
      if (normalized.length > 20) {
        setError("Username too long (max 20)");
        return;
      }
      /* v8 ignore start */
      if (!USERNAME_RE.test(normalized)) {
        setError("Only letters, numbers, and _ allowed");
        return;
      }
      /* v8 ignore stop */
      if (available === false) {
        setError("Username is taken");
        return;
      }
      if (available === null) {
        setError("Still checking username — wait a moment");
        return;
      }
    }
    setStep((s) => Math.min(s + 1, 3) as Step);
  }, [step, username, available]);

  const goBack = () => {
    setError("");
    setStep((s) => Math.max(s - 1, 1) as Step);
  };

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const normalized = username.trim();
      const profile = await createProfile(uid, normalized, stance, emailVerified);
      onDone(profile);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create profile");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && step < 3) {
        e.preventDefault();
        goNext();
      }
    },
    [step, goNext],
  );

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div
        className="w-full max-w-sm p-8 rounded-2xl bg-surface border border-border animate-fade-in"
        onKeyDown={handleKeyDown}
      >
        <ProgressBar step={step} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step < 3) goNext();
            else submit();
          }}
          noValidate
        >
          {step === 1 && (
            <StepUsername
              username={username}
              setUsername={setUsername}
              available={available}
              loading={loading}
              onNext={goNext}
              error={error}
              onClearError={() => setError("")}
            />
          )}
          {step === 2 && <StepStance stance={stance} setStance={setStance} onNext={goNext} onBack={goBack} />}
          {step === 3 && (
            <StepReview
              username={username}
              stance={stance}
              loading={loading}
              error={error}
              onSubmit={submit}
              onBack={goBack}
            />
          )}
        </form>
      </div>
    </div>
  );
}
