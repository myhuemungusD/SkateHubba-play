import { useState } from "react";
import { getUidByUsername, type UserProfile } from "../services/users";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { InviteButton } from "../components/InviteButton";
import { Leaderboard } from "../components/Leaderboard";

export function ChallengeScreen({
  profile,
  onSend,
  onBack,
  initialOpponent = "",
}: {
  profile: UserProfile;
  onSend: (opponentUid: string, opponentUsername: string) => Promise<void>;
  onBack: () => void;
  initialOpponent?: string;
}) {
  const [opponent, setOpponent] = useState(initialOpponent);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    const normalized = opponent.toLowerCase().trim();
    if (normalized.length < 3) {
      setError("Enter a valid username");
      return;
    }
    if (normalized === profile.username) {
      setError("You can't challenge yourself");
      return;
    }

    setLoading(true);
    try {
      const uid = await getUidByUsername(normalized);
      if (!uid) {
        setError(`@${normalized} doesn't exist yet. They need to sign up first.`);
        return;
      }
      await onSend(uid, normalized);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start game");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/80 px-6 pt-6">
      <div className="max-w-md mx-auto">
        <button type="button" onClick={onBack} className="font-body text-sm text-[#888] mb-6 flex items-center gap-1.5">
          ← Back
        </button>

        <h1 className="font-display text-[42px] text-white mb-2">Challenge</h1>
        <p className="font-body text-sm text-[#888] mb-8">Call someone out. First to S.K.A.T.E. loses.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <Field
            label="Opponent Username"
            value={opponent}
            onChange={(v) => {
              if (!loading) setOpponent(v.replace(/[^a-zA-Z0-9_]/g, ""));
            }}
            placeholder="their_handle"
            icon="@"
            maxLength={20}
            autoFocus
          />

          <InviteButton username={profile.username} className="mb-6" />

          <div className="p-4 rounded-xl bg-surface-alt border border-border mb-6">
            <h4 className="font-display text-xs tracking-[0.12em] text-[#555] mb-3">RULES</h4>
            <div className="font-body text-sm text-[#888] leading-7">
              <div>🎯 You set the first trick</div>
              <div>📹 One-take video only — no retries</div>
              <div>⏱ 24 hours per turn or forfeit</div>
              <div>❌ Miss a match = earn a letter</div>
              <div>💀 Spell S.K.A.T.E. = you lose</div>
            </div>
          </div>

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          <Btn onClick={submit} disabled={loading || opponent.length < 3}>
            {loading ? "Finding..." : "🔥 Send Challenge"}
          </Btn>
        </form>

        <Leaderboard currentUserUid={profile.uid} onChallengeUser={(username) => setOpponent(username)} />
      </div>
    </div>
  );
}
