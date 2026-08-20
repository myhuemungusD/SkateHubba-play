import type { ProfileStats } from "../usePlayerProfileController";
import { MIN_RATED_GAMES } from "../../../constants/stats";
import { CategoryLabel, Row, StatTile, type StatTileName } from "./StatTile";
import { LastTenPips } from "./LastTenPips";

/**
 * Profile stats grid — the public, achievements-facing view of a player.
 *
 * Organised into categories rather than one flat wall of tiles:
 *   • RECORD     — volume, rate, streaks, and the last-10 form guide.
 *   • GAME STYLE — how they win: clean wins, comebacks, completion rate.
 *   • LETTERS    — SKATE letters handed out vs. taken.
 *   • COMMUNITY  — judging and binding-dispute record.
 *   • VS YOU     — head-to-head with the viewer; opponent profile only.
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
  return (
    <div className="mb-8">
      <CategoryLabel title="RECORD" />
      <Row testid="brag-row" cols="grid-cols-3">
        <StatTile
          name="wins"
          label="Lifetime Wins"
          value={stats.wins}
          ariaLabel={`Lifetime wins: ${stats.wins}`}
          onTap={onTileTap}
        />
        <StatTile
          name="losses"
          label="Lifetime Losses"
          value={stats.losses}
          ariaLabel={`Lifetime losses: ${stats.losses}`}
          onTap={onTileTap}
        />
        {/* A rate over fewer than MIN_RATED_GAMES games is noise dressed as a
            fact (1-0 reads "100%"), so it stays a dash until the floor is met.
            The aria-label says why rather than announcing a bare "dash". */}
        <StatTile
          name="winRate"
          label="Win Rate %"
          value={stats.winRate}
          suffix="%"
          ariaLabel={
            stats.winRate === null
              ? `Win rate: not enough games yet, ${MIN_RATED_GAMES} needed`
              : `Win rate: ${stats.winRate} percent`
          }
          onTap={onTileTap}
        />
      </Row>

      <Row testid="detail-row" cols="grid-cols-3">
        <StatTile
          name="totalGames"
          label="Total Games"
          value={stats.total}
          ariaLabel={`Total games: ${stats.total}`}
          onTap={onTileTap}
        />
        <StatTile
          name="bestStreak"
          label="Best Streak"
          value={stats.bestWinStreak}
          ariaLabel={`Best win streak: ${stats.bestWinStreak}`}
          onTap={onTileTap}
        />
        <StatTile
          name="currentStreak"
          label="Current Streak"
          value={stats.currentWinStreak}
          ariaLabel={`Current win streak: ${stats.currentWinStreak}`}
          onTap={onTileTap}
        />
      </Row>

      <LastTenPips results={stats.recentResults} />

      <CategoryLabel title="GAME STYLE" />
      <Row testid="game-style-row" cols="grid-cols-3">
        <StatTile
          name="cleanWins"
          label="Clean Wins"
          value={stats.cleanWins}
          ariaLabel={`Clean wins: ${stats.cleanWins}`}
          onTap={onTileTap}
        />
        <StatTile
          name="comebackWins"
          label="Comeback Wins"
          value={stats.comebackWins}
          ariaLabel={`Comeback wins: ${stats.comebackWins}`}
          onTap={onTileTap}
        />
        {/* Null until the player has a completed game — a completion rate over
            zero games would print "100%" for someone who has never played. */}
        <StatTile
          name="challengeCompletion"
          label="Games Finished"
          value={stats.challengeCompletion}
          suffix="%"
          ariaLabel={
            stats.challengeCompletion === null
              ? "Games finished: no completed games yet"
              : `Games finished: ${stats.challengeCompletion} percent`
          }
          onTap={onTileTap}
        />
      </Row>

      <CategoryLabel title="LETTERS" />
      <Row testid="letters-row" cols="grid-cols-2">
        <StatTile
          name="lettersGiven"
          label="Letters Given"
          value={stats.lettersGiven}
          ariaLabel={`Letters given: ${stats.lettersGiven}`}
          onTap={onTileTap}
        />
        <StatTile
          name="lettersTaken"
          label="Letters Taken"
          value={stats.lettersTaken}
          ariaLabel={`Letters taken: ${stats.lettersTaken}`}
          onTap={onTileTap}
        />
      </Row>

      <CategoryLabel title="COMMUNITY" />
      <Row testid="judging-row" cols="grid-cols-2">
        <StatTile
          name="gamesJudged"
          label="Games Judged"
          value={stats.gamesJudged}
          ariaLabel={`Games judged: ${stats.gamesJudged}`}
          onTap={onTileTap}
        />
      </Row>
      <Row testid="disputes-row" cols="grid-cols-2">
        <StatTile
          name="tricksDisputed"
          label="Tricks of yours disputed"
          value={stats.tricksDisputed}
          ariaLabel={`Tricks of yours disputed: ${stats.tricksDisputed}`}
          onTap={onTileTap}
        />
        <StatTile
          name="disputesRaised"
          label="Tricks you disputed"
          value={stats.disputesRaised}
          ariaLabel={`Tricks you disputed: ${stats.disputesRaised}`}
          onTap={onTileTap}
        />
      </Row>
      <Row testid="disputes-record-row" cols="grid-cols-2">
        <StatTile
          name="disputesRight"
          label="Right"
          value={stats.disputesRight}
          ariaLabel={`Disputes you got right: ${stats.disputesRight}`}
          onTap={onTileTap}
        />
        <StatTile
          name="disputesWrong"
          label="Wrong"
          value={stats.disputesWrong}
          ariaLabel={`Disputes you got wrong: ${stats.disputesWrong}`}
          onTap={onTileTap}
        />
      </Row>

      {!isOwnProfile && hasCompletedGames && (
        <>
          <CategoryLabel title="VS YOU" />
          <Row testid="vs-you-row" cols="grid-cols-3">
            <StatTile
              name="vsYouWins"
              label="Your Wins"
              value={stats.vsYouWins}
              ariaLabel={`Your wins: ${stats.vsYouWins}`}
              onTap={onTileTap}
            />
            <StatTile
              name="vsYouLosses"
              label="Your Losses"
              value={stats.vsYouLosses}
              ariaLabel={`Your losses: ${stats.vsYouLosses}`}
              onTap={onTileTap}
            />
            <StatTile
              name="vsYouTotal"
              label="Games"
              value={stats.vsYouTotal}
              ariaLabel={`Total head-to-head games: ${stats.vsYouTotal}`}
              onTap={onTileTap}
            />
          </Row>
        </>
      )}
    </div>
  );
}
