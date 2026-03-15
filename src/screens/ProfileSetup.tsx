import { useState, useEffect, useRef } from "react";
import { createProfile, isUsernameAvailable, type UserProfile } from "../services/users";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";

export function ProfileSetup({
  uid,
  email,
  emailVerified = false,
  displayName,
  onDone,
}: {
  uid: string;
  email: string;
  emailVerified?: boolean;
  displayName?: string | null;
  onDone: (p: UserProfile) => void;
}) {
  const suggested = (displayName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  const [username, setUsername] = useState(suggested);
  const [stance, setStance] = useState("Regular");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const checkRef = useRef<number>(0);

  useEffect(() => {
    setAvailable(null);
    const normalized = username.toLowerCase().trim();
    if (normalized.length < 3) return;

    const id = ++checkRef.current;
    const timeout = setTimeout(async () => {
      try {
        const ok = await isUsernameAvailable(normalized);
        if (checkRef.current === id) setAvailable(ok);
      } catch {
        if (checkRef.current === id) setAvailable(null);
        setError("Could not check username — try again");
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [username]);

  const submit = async () => {
    setError("");
    const normalized = username.toLowerCase().trim();
    if (normalized.length < 3) {
      setError("Username must be 3+ characters");
      return;
    }
    if (normalized.length > 20) {
      setError("Username too long (max 20)");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(normalized)) {
      setError("Only letters, numbers, and _ allowed");
      return;
    }
    if (available === false) {
      setError("Username is taken");
      return;
    }
    if (available === null) {
      setError("Still checking username — wait a moment");
      return;
    }

    setLoading(true);
    try {
      const profile = await createProfile(uid, email, normalized, stance, emailVerified);
      onDone(profile);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]">
      <div className="w-full max-w-sm p-8 rounded-2xl bg-surface border border-border animate-fade-in">
        <span className="font-display text-xs tracking-[0.3em] text-brand-orange block mb-2">PROFILE SETUP</span>
        <h2 className="font-display text-3xl text-white mb-1">Lock in your handle</h2>
        <p className="font-body text-sm text-[#888] mb-7">This is how the crew knows you.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <Field
            label="Username"
            value={username}
            onChange={(v) => {
              if (!loading) setUsername(v.replace(/[^a-zA-Z0-9_]/g, ""));
            }}
            placeholder="sk8legend"
            maxLength={20}
            icon="@"
            autoComplete="username"
            autoFocus
            note={
              username.length >= 3
                ? available === null
                  ? "Checking..."
                  : available
                    ? `@${username.toLowerCase()} is available ✓`
                    : `@${username.toLowerCase()} is taken ✗`
                : "Min 3 characters, letters/numbers/underscore"
            }
          />

          <fieldset className="mb-6">
            <legend className="block font-display text-sm tracking-[0.12em] text-[#888] mb-2">Stance</legend>
            <div className="flex gap-3" role="radiogroup" aria-label="Skating stance">
              {["Regular", "Goofy"].map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={stance === s}
                  onClick={() => {
                    if (!loading) setStance(s);
                  }}
                  disabled={loading}
                  className={`flex-1 py-3 rounded-xl font-display text-lg tracking-wider cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed
                    ${
                      stance === s
                        ? "bg-[rgba(255,107,0,0.08)] border border-brand-orange text-brand-orange"
                        : "bg-surface-alt border border-border text-[#888]"
                    }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          <Btn onClick={submit} disabled={loading || username.length < 3 || available !== true}>
            {loading ? "Creating..." : "Lock It In"}
          </Btn>
        </form>
      </div>
    </div>
  );
}
