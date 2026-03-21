import { useState } from "react";
import { getUidByUsername, type UserProfile } from "../services/users";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { InviteButton } from "../components/InviteButton";
import { Leaderboard } from "../components/Leaderboard";
import {
  TargetIcon,
  FilmIcon,
  ClockIcon,
  XCircleIcon,
  SkullIcon,
  FlameIcon,
  type IconProps,
} from "../components/icons";

const RULES: { Icon: (props: IconProps) => JSX.Element; text: string; color: string }[] = [
  { Icon: TargetIcon, text: "You set the first trick", color: "text-brand-orange" },
  { Icon: FilmIcon, text: "One-take video only — no retries", color: "text-brand-orange" },
  { Icon: ClockIcon, text: "24 hours per turn or forfeit", color: "text-brand-orange" },
  { Icon: XCircleIcon, text: "Miss a match = earn a letter", color: "text-brand-red" },
  { Icon: SkullIcon, text: "Spell S.K.A.T.E. = you lose", color: "text-brand-red" },
];

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

        <h1 className="font-display text-fluid-4xl text-white mb-2">Challenge</h1>
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

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          <Btn onClick={submit} disabled={loading || opponent.length < 3}>
            {loading ? (
              "Finding..."
            ) : (
              <>
                <FlameIcon size={16} className="inline -mt-0.5" /> Send Challenge
              </>
            )}
          </Btn>

          <div className="p-4 rounded-xl bg-surface-alt border border-border mb-4 mt-8">
            <h4 className="font-display text-xs tracking-[0.12em] text-[#555] mb-3">RULES</h4>
            <div className="font-body text-sm text-[#888] space-y-2">
              {RULES.map(({ Icon, text, color }) => (
                <div key={text} className="flex items-center gap-2">
                  <Icon size={15} className={`${color} shrink-0`} /> {text}
                </div>
              ))}
            </div>
          </div>

          <InviteButton username={profile.username} className="mb-6" />
        </form>

        <Leaderboard currentUserUid={profile.uid} onChallengeUser={(username) => setOpponent(username)} />
      </div>
    </div>
  );
}
