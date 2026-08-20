import type { UserProfile } from "../../services/users";
import { ChevronLeftIcon } from "../../components/icons";
import { deriveMyStats } from "./deriveMyStats";

/**
 * "My Stats" — the owner-only analytics surface.
 *
 * The public profile is achievements-facing: it shows what a player has
 * earned. This screen is the honest mirror behind it, and it is the only
 * place the negative and manipulable counters appear — games abandoned,
 * tricks failed — because a public forfeit count invites both gaming and
 * shaming, while the player's own copy is just feedback.
 *
 * Data comes from the caller's `profile`, which App.tsx passes straight from
 * `auth.activeProfile` — the same own-profile snapshot PlayerProfileScreen
 * reads (see usePlayerProfileController: own-profile never refetches). That
 * also *is* the own-profile gate: the route renders nothing without an
 * active profile, so there is no path to another player's numbers.
 *
 * Every counter is server-written and optional; missing fields read as 0 and
 * rates read as "—" rather than "0%" (see deriveMyStats).
 */

interface Props {
  profile: UserProfile;
  onBack: () => void;
}

/** Shown where a rate has no denominator yet — matches the profile grid. */
const UNAVAILABLE = "—";

function SectionLabel({ title }: { title: string }) {
  return <p className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2.5 mt-6 first:mt-0">{title}</p>;
}

/**
 * One metric. Non-interactive by design: unlike the public grid's tiles there
 * is no tap telemetry to collect on your own numbers, and a button that does
 * nothing is worse than plain text.
 */
function Metric({ label, value, suffix }: { label: string; value: string | number | null; suffix?: string }) {
  const shown = value === null ? UNAVAILABLE : `${value}${suffix ?? ""}`;
  return (
    <div className="rounded-xl bg-surface border border-white/[0.06] shadow-card p-3">
      <p className={`font-display text-xl leading-none tabular-nums ${value === null ? "text-subtle" : "text-white"}`}>
        {shown}
      </p>
      <p className="font-body text-[10px] uppercase tracking-wider text-subtle mt-1.5">{label}</p>
    </div>
  );
}

function Row({ testid, children }: { testid: string; children: React.ReactNode }) {
  return (
    <div data-testid={testid} className="grid grid-cols-3 gap-2 mb-2 animate-fade-in">
      {children}
    </div>
  );
}

export function MyStatsScreen({ profile, onBack }: Props) {
  const s = deriveMyStats(profile);

  return (
    <div className="min-h-dvh pb-24 overflow-y-auto bg-profile-glow">
      <div className="px-5 pt-safe pb-4 flex justify-between items-center border-b border-white/[0.04] glass">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 touch-target text-muted hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange rounded-lg"
          aria-label="Back to profile"
        >
          <ChevronLeftIcon size={16} />
          <span className="font-body text-xs">Profile</span>
        </button>
        <img
          src="/logonew.webp"
          alt=""
          draggable={false}
          className="h-5 w-auto select-none opacity-40"
          aria-hidden="true"
        />
        <div className="w-16" aria-hidden="true" />
      </div>

      <div className="px-5 pt-7 max-w-[430px] mx-auto">
        <h1 className="font-display text-fluid-4xl text-white mb-2 tracking-wide">My Stats</h1>
        <p className="font-body text-sm text-muted mb-2">
          The deep numbers behind your record. Only you can see this page.
        </p>
        {s.gamesPlayed === 0 && (
          <p className="font-body text-xs text-faint mb-2">Finish a game and these start filling in.</p>
        )}

        <SectionLabel title="GAMES" />
        <Row testid="my-stats-games-row">
          <Metric label="Games Played" value={s.gamesPlayed} />
          <Metric label="Games Abandoned" value={s.gamesAbandoned} />
          <Metric label="Avg Game Length" value={s.avgGameLength} />
        </Row>

        <SectionLabel title="TRICKS" />
        <Row testid="my-stats-tricks-row">
          <Metric label="Trick Consistency" value={s.trickConsistency} suffix="%" />
          <Metric label="Tricks Landed" value={s.tricksLanded} />
          <Metric label="Tricks Failed" value={s.tricksFailed} />
        </Row>

        <SectionLabel title="LETTERS" />
        <Row testid="my-stats-letters-row">
          <Metric label="Letters Given" value={s.lettersGiven} />
          <Metric label="Letters Taken" value={s.lettersTaken} />
          <Metric label="Letters Taken / Game" value={s.avgLettersTaken} />
        </Row>

        <SectionLabel title="WINS" />
        <Row testid="my-stats-wins-row">
          <Metric label="Clean Wins" value={s.cleanWins} />
          <Metric label="Comeback Wins" value={s.comebackWins} />
        </Row>

        <SectionLabel title="JUDGING" />
        <Row testid="my-stats-judging-row">
          <Metric label="Games Judged" value={s.gamesJudged} />
          <Metric label="Turns Judged" value={s.turnsJudged} />
        </Row>
      </div>
    </div>
  );
}
