import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ProfileStats } from "../usePlayerProfileController";
import { MIN_RATED_GAMES } from "../../../constants/stats";
import { FlameIcon } from "../../../components/icons";
import { CategoryLabel, Row, StatTile, type StatTileName } from "./StatTile";
import { LastTenPips } from "./LastTenPips";

/**
 * Profile stats — the public, achievements-facing view of a player.
 *
 * Progressive disclosure (Strava / Chess.com): four headline numbers and the
 * last-10 form guide are always visible; everything else sits behind
 * "All stats" so the profile isn't a 20-tile wall.
 *   • Headline   — wins, losses, win rate, current streak (flame from 2+;
 *                  this replaces the old standalone win-streak banner).
 *   • All stats  — totals and best streak, GAME STYLE, LETTERS, COMMUNITY.
 *   • VS YOU     — head-to-head with the viewer; opponent profile only,
 *                  kept visible because it's the one block about *you*.
 *
 * Nothing here surfaces a negative, manipulable counter. `forfeitLosses` and
 * `tricksFailed` exist on the profile doc and are deliberately absent from
 * this screen: the public framing of abandonment is the positive
 * "challenge completion" rate, and the raw numbers live on the owner-only
 * My Stats screen. Rendering tiles/rows is delegated to ./StatTile.
 *
 * Every counter reads 0 (or an empty run) on profiles predating its
 * server-side counter — see usePlayerProfileController.
 */

/** A one-game "streak" is just a win; the flame starts at two. */
export const MIN_DISPLAYED_WIN_STREAK = 2;

interface Props {
  stats: ProfileStats;
  isOwnProfile: boolean;
  /** Used to suppress the VS-You row when there are no shared games yet. */
  hasCompletedGames: boolean;
  /** Tap handler for stat tiles — fires `profileStatTileTapped` telemetry. */
  onTileTap?: (statName: StatTileName) => void;
}

export type { StatTileName } from "./StatTile";

export function ProfileStatsGrid({ stats, isOwnProfile, hasCompletedGames, onTileTap }: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const onStreak = stats.currentWinStreak >= MIN_DISPLAYED_WIN_STREAK;

  return (
    <div className="mb-8">
      <Row testid="brag-row" cols="grid-cols-4">
        <StatTile name="wins" label="Wins" value={stats.wins} onTap={onTileTap} />
        <StatTile name="losses" label="Losses" value={stats.losses} onTap={onTileTap} />
        {/* A rate over fewer than MIN_RATED_GAMES games is noise dressed as a
            fact (1-0 reads "100%"), so it stays a dash until the floor is met,
            and the spoken value says why rather than announcing a bare dash. */}
        <StatTile
          name="winRate"
          label="Win %"
          value={stats.winRate}
          suffix="%"
          spokenValue={stats.winRate === null ? `not enough games yet, ${MIN_RATED_GAMES} needed` : undefined}
          onTap={onTileTap}
        />
        <StatTile
          name="currentStreak"
          label="Streak"
          value={stats.currentWinStreak}
          spokenValue={onStreak ? `${stats.currentWinStreak} game win streak` : undefined}
          icon={onStreak ? <FlameIcon size={16} className="text-brand-orange" aria-hidden="true" /> : undefined}
          onTap={onTileTap}
        />
      </Row>

      <LastTenPips results={stats.recentResults} />

      {!isOwnProfile && hasCompletedGames && (
        <>
          <CategoryLabel title="VS YOU" />
          <Row testid="vs-you-row" cols="grid-cols-3">
            <StatTile name="vsYouWins" label="Your Wins" value={stats.vsYouWins} onTap={onTileTap} />
            <StatTile name="vsYouLosses" label="Your Losses" value={stats.vsYouLosses} onTap={onTileTap} />
            <StatTile name="vsYouTotal" label="Games" value={stats.vsYouTotal} onTap={onTileTap} />
          </Row>
        </>
      )}

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((open) => !open)}
        className="mt-1 flex min-h-11 w-full items-center justify-between rounded-xl px-1 font-body text-sm font-semibold text-bright hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        All stats
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`text-subtle transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <div id={panelId} hidden={!expanded} data-testid="all-stats">
        {expanded && <AllStats stats={stats} onTileTap={onTileTap} />}
      </div>
    </div>
  );
}

function AllStats({ stats, onTileTap }: Pick<Props, "stats" | "onTileTap">) {
  return (
    <>
      <Row testid="detail-row" cols="grid-cols-2">
        <StatTile name="totalGames" label="Total Games" value={stats.total} onTap={onTileTap} />
        <StatTile name="bestStreak" label="Best Streak" value={stats.bestWinStreak} onTap={onTileTap} />
      </Row>

      <CategoryLabel title="GAME STYLE" />
      <Row testid="game-style-row" cols="grid-cols-3">
        <StatTile name="cleanWins" label="Clean Wins" value={stats.cleanWins} onTap={onTileTap} />
        <StatTile name="comebackWins" label="Comeback Wins" value={stats.comebackWins} onTap={onTileTap} />
        {/* Null until the player has a completed game — a completion rate over
            zero games would print "100%" for someone who has never played. */}
        <StatTile
          name="challengeCompletion"
          label="Games Finished"
          value={stats.challengeCompletion}
          suffix="%"
          spokenValue={stats.challengeCompletion === null ? "no completed games yet" : undefined}
          onTap={onTileTap}
        />
      </Row>

      <CategoryLabel title="LETTERS" />
      <Row testid="letters-row" cols="grid-cols-2">
        <StatTile name="lettersGiven" label="Letters Given" value={stats.lettersGiven} onTap={onTileTap} />
        <StatTile name="lettersTaken" label="Letters Taken" value={stats.lettersTaken} onTap={onTileTap} />
      </Row>

      <CategoryLabel title="COMMUNITY" />
      <Row testid="judging-row" cols="grid-cols-3">
        <StatTile name="gamesJudged" label="Games Judged" value={stats.gamesJudged} onTap={onTileTap} />
        <StatTile name="disputesRight" label="Disputes Right" value={stats.disputesRight} onTap={onTileTap} />
        <StatTile name="disputesWrong" label="Disputes Wrong" value={stats.disputesWrong} onTap={onTileTap} />
      </Row>
      <Row testid="disputes-row" cols="grid-cols-2">
        <StatTile
          name="tricksDisputed"
          label="Tricks of yours disputed"
          value={stats.tricksDisputed}
          onTap={onTileTap}
        />
        <StatTile name="disputesRaised" label="Tricks you disputed" value={stats.disputesRaised} onTap={onTileTap} />
      </Row>
    </>
  );
}
