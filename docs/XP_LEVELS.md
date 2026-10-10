# XP and Levels

**Status:** Design for approval. Nothing in this document is implemented.
**Owner:** Jason. This is the sign-off `docs/STATS.md` asks for before Tier 3.
**Unblocks:** the level chip and the 12-tile achievements ribbon, both of which exist in the repo and render nothing real today.

This is a proposal. The numbers below are the recommended defaults. The open questions at the end are the calls that would change the build.

## What already exists

| Piece | Today |
| --- | --- |
| `src/components/LevelChip.tsx` | Renders a hard-coded `L1` and ignores the `level` prop. The prop is already `level?: number`, clamped in the comment to 1..30. |
| `ProfileIdentityCard` | The chip used to sit next to the username. It was taken off the profile because every account showed the same meaningless L1. |
| `AchievementsRibbon` | Draws 12 locked tiles (`???` + a lock icon). It is not mounted. `PlayerProfileScreen` says a placeholder on a live profile reads as an unfinished product. |
| `BadgesRow` | Mounted. Renders whatever is actually granted under `users/{uid}/achievements`. The launch set is the five Economy Phase A badges in `src/constants/badges.ts`: Century, 150 Club, OG, Streak (10 wins), Pioneer. |
| Stats close-out | `functions/src/applyGameStats.ts`, called from `onGameCompleted` in `functions/src/index.ts`. One transaction per terminal game, guarded by `games/{id}.statsApplied`. |
| Dispute stats | A different writer. `api/cron/resolve-expired-disputes.ts` increments `tricksDisputed`, `disputesRaised`, `disputesRight`, and `disputesWrong` when a community dispute closes. There is no per-user count of dispute *votes*. |

`docs/STATS.md` Tier 3 names this work: XP/level to unblock the chip, and server-written achievements into the subcollection that already exists. Tier 3 needs maintainer sign-off because it widens the close-out function past the original "stats close-out" approval (2026-07).

`docs/ECONOMY.md` is a different system. Phase A is badges and the Locker. Phase B is Hubba Bucks. XP is neither. A level does not spend, does not buy a badge, and does not convert into Hubba Bucks. Badges stay unbuyable. Dice stays out: `docs/DICE.md` keeps dice games in `diceGames`, and `onGameCompleted` never sees them.

## Why the server writes it

In July 2026 a client replay (`GameContext.fanOutStats`) corrupted production `wins` / `losses`. The fix was to delete the client write and move the counters into `applyGameStats`, which the Admin SDK runs once per game. Firestore rules list every one of those fields in `affectedKeys().hasAny([...])`, so an owner update that touches them is denied. The same list is why a new counter has to be named in the rules or a signup can mint it.

XP is a counter of that same kind. The client reads it. The close-out writes it, in the transaction that already flips `statsApplied`. A second client write would reopen the hole that corrupted the win counters.

The CI allowlist (`verify-no-cloud-functions` in `.github/workflows/pr-gate.yml`) already permits edits to:

- `functions/src/index.ts`
- `functions/src/index.test.ts`
- `functions/src/applyGameStats.ts`
- `functions/src/applyGameStats.test.ts`
- `functions/src/dice/*.ts`

The recommended build adds no file under `functions/src/`. The gate does not change. A new `functions/src/xp.ts` would fail the gate until the allowlist is edited and you sign off on that edit. The soft file-length budget on services is 400 lines; `applyGameStats.ts` is 331 today. If the XP math pushes it past 400, that is a warning, and the hard gate wins: keep the math in the allowlisted file rather than splitting out a new one.

`functions/tsconfig.json` compiles only `functions/src` (`rootDir` is `src`). The function cannot import `src/constants/` from the app. The level table below is the source of truth. The function and the client each carry a copy, and each copy has a test pinned to three rows (level 2 = 100, level 10 = 5,825, level 30 = 50,750) so the copies cannot drift quietly.

## What earns XP

Play XP is for the two skaters. Referee XP is for the accepted judge and for people who voted on a dispute. They have separate daily caps so a game and a judging session do not eat each other.

All figures are integers. Halves round down.

### Play XP

| Event | Who | XP |
| --- | --- | --- |
| Finish a game whose status is `complete` | Both players | 40 |
| Win that game | Winner | 25 |
| Land a trick in that game | The matcher who landed it | 8 each |
| Give a letter (the opponent missed your trick) | The player who gave it | 4 each |
| Shutout — `cleanWins` would increment (winner took no letter) | Winner | 15 extra |
| Comeback — `comebackWins` would increment (winner peaked at 4 letters, S.K.A.T.) | Winner | 20 extra |
| First qualifying game of the UTC day | That player | 25 |

Trick and letter counts come from the walk `deriveGameStats` already does over `turnHistory`. A setter's own set is not a landed trick. A miss earns nothing for the person who missed. Letters given are capped by the game itself: the loser takes at most 5.

"Qualifying" means the game still pays some play XP after the anti-farming rules below. An empty forfeit does not burn the daily-first bonus.

### Referee XP

| Event | Who | XP |
| --- | --- | --- |
| Accepted judge who ruled at least one turn (`judgedBy` names them) | That judge | 30 |
| Each of those turns | That judge | 5 each |
| A community vote still on the dispute when it closes | That voter | 10 |
| That vote matches a final `land` or `bail` verdict | That voter | 5 extra |

A tie or a zero-vote close pays the 10 for a vote that existed, and pays no extra 5. The two players cannot vote on their own dispute; the rules already reject that. A vote deleted before close is gone, so it pays nothing.

Judge credit uses the fields the close-out already trusts: `judgeId` plus `judgeStatus === "accepted"`, and the `judgedBy` tally from `deriveGameStats`. This does not change what `gamesJudged` or `turnsJudged` mean. Those counters keep moving exactly as they do now. XP is a separate number written beside them.

### One finished game, as a worked example

A beats B. Status `complete`. A landed 4 tricks and gave 3 letters. B landed 2 and gave 2. A took at least one letter, and never sat on S.K.A.T., so there is no shutout and no comeback. It is A's first game today and B's second. They have not played each other yet today. Both accounts are older than a day.

- A: 40 finish + 25 win + 32 landed + 12 letters + 25 daily first = **134**
- B: 40 finish + 16 landed + 8 letters = **64**

An accepted judge who ruled on 2 turns of that game gets 30 + 10 = **40** referee XP, whether or not they also played today.

### What a typical week is

The pace numbers later in this doc use one imaginary player:

- 3 finished games a week, on 3 different days
- a different opponent often enough that the repeat rule does not cut them
- wins half
- lands 4 tricks and gives 3 letters per game
- takes the daily-first bonus on each of those 3 days
- does not judge

That is 40 + 12.5 + 32 + 12 + 25 = **121.5 XP a game**, about **365 XP a week**, about **19,000 XP a year**. Someone who finishes one game a week moves at about a third of that.

The real brake on farming is that a game requires filmed tricks. XP rides on games the app already required video for. The rules below are for what is left: two people filming nonsense, a throwaway account, or a forfeit that never started.

## Anti-farming

Applied in this order, inside the close-out, before the XP is added:

1. **Empty forfeit.** Status `forfeit` and `turnHistory` has fewer than 2 entries. Pay 0 play XP. Do not mark the daily first as used. Judge XP still follows the ruling rule, so a history with no `judgedBy` for them pays 0. The only forfeit path today is the 24-hour turn deadline (`forfeitExpiredTurn` and `api/cron/sweep-expired-turns.ts`). "Instant" here means the game never became a skate: the first turn expired, or the history is empty. There is no separate resign button.

2. **Forfeit after real skating.** Status `forfeit` and `turnHistory` has 2 or more entries. The winner gets the 40 finish and their trick and letter XP. The winner does not get the 25 win bonus, the shutout bonus, or the comeback bonus. The loser gets 20 instead of 40, plus their trick and letter XP. Showing up and then timing out still counts. Winning because the other person disappeared does not count as a win for XP.

3. **New accounts.** If either player's `createdAt` is missing, or is less than 24 hours before the game's `createdAt`, pay 0 play XP to both. Referee XP still pays. Creating a game already requires a verified email (`firestore.rules` on `/games` create). This extra day is for a pair of accounts made the same afternoon. It does not see two accounts on one phone. That gap stays open on purpose for v1.

4. **Same opponent, same UTC day.** Doc id `xpPairs/{uidA}_{uidB}` with the two uids sorted, so both players share one counter. Fields: `utcDay` (`YYYY-MM-DD`) and `count`. The close-out reads it in the same transaction.
   - 1st game that day between this pair: 100% of the play XP so far
   - 2nd: 50%, rounded down
   - 3rd and after: 0
   The judge's XP is not cut by this. The pair doc is server-only. Clients never read or write it. Unmatched paths in `firestore.rules` are already denied, so this collection gets no new rule block.

5. **Daily first.** If play XP is still above 0 after the steps above, and this player has no play XP recorded for today's UTC date, add 25.

6. **Daily caps.** After the bonus:
   - Play bucket: **300 XP** per UTC day. A strong game is ~130, so two games against different people fit, and a third starts getting cut.
   - Referee bucket: **80 XP** per UTC day. One judged game plus a few votes fits. A second judged game mostly does not.
   Leftover XP above the cap is dropped. It is not banked for tomorrow.

Achievements do not grant XP and do not touch either cap.

Dice, clips, spots, and profile edits grant nothing.

## The level curve

Level 1 is 0 XP. The chip shows levels 1 through 30.

```
xpToReach(1) = 0
xpToReach(L) = floor(100 * (L - 1) ^ 1.85)    for L from 2 to 30
```

A player's level is the highest `L` with `xpToReach(L) <= xp`, and it never goes past 30. The integers below were produced with JavaScript `Math.pow` and checked against the same expression in Python. **The table is what the code copies.** Do not recompute the exponent in two places and hope they match.

`XP this level` is how much you need to climb from the previous level. `Total XP` is the lifetime total required to *be* that level.

| Level | Total XP | XP this level | Level | Total XP | XP this level |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 16 | 14,988 | 1,796 |
| 2 | 100 | 100 | 17 | 16,889 | 1,901 |
| 3 | 360 | 260 | 18 | 18,894 | 2,005 |
| 4 | 763 | 403 | 19 | 21,001 | 2,107 |
| 5 | 1,299 | 536 | 20 | 23,211 | 2,210 |
| 6 | 1,963 | 664 | 21 | 25,521 | 2,310 |
| 7 | 2,751 | 788 | 22 | 27,932 | 2,411 |
| 8 | 3,659 | 908 | 23 | 30,442 | 2,510 |
| 9 | 4,685 | 1,026 | 24 | 33,051 | 2,609 |
| 10 | 5,825 | 1,140 | 25 | 35,759 | 2,708 |
| 11 | 7,079 | 1,254 | 26 | 38,564 | 2,805 |
| 12 | 8,444 | 1,365 | 27 | 41,466 | 2,902 |
| 13 | 9,919 | 1,475 | 28 | 44,465 | 2,999 |
| 14 | 11,502 | 1,583 | 29 | 47,560 | 3,095 |
| 15 | 13,192 | 1,690 | 30 | 50,750 | 3,190 |

XP past 50,750 still accumulates. The chip stays at L30. Raising the cap later is a new row in this table, not a second backfill.

### How long that takes

Times use the typical week above (~365 XP).

| Band | Levels | You get here when | Typical player |
| --- | --- | --- | --- |
| Just started | 1 | 0 XP | The day the account is created |
| First sessions | 2–4 | 100 XP | Level 2 is the first good game (~134 XP). Level 5 is about a month of the typical week. |
| Regular | 5–9 | 1,299 XP | About a month in. Level 10 is about four months. |
| Still here | 10–19 | 5,825 XP | About four months in. Level 20 is about fifteen months. |
| Kept skating | 20–29 | 23,211 XP | About fifteen months in, through about two and a half years. |
| Cap | 30 | 50,750 XP | About two years and eight months. |

A player who hits the 300 play cap every single day reaches 50,750 in about 169 days. That is the ceiling, and it still requires a filmed game against people they are not repeating. One game a week reaches level 10 in about a year and the cap in about eight years.

## The 12 ribbon achievements

These fill `AchievementsRibbon`. They are not the five Economy badges. Those stay on `BadgesRow`, with the same ids (`century`, `club150`, `og`, `streak10`, `pioneer`), and they stay rare. The ribbon ids below are different docs in the same subcollection, so a grant cannot show up in the wrong row.

Every criterion is a comparison against counters the server already maintains. `consistent` uses two of them. None of the 12 needs a new counter.

The close-out grants a doc when the counters *after this game* cross the line and the doc is absent. Shape stays what the rules already pin: `{ earnedAt, reason }`, `reason` at most 200 characters. The Admin SDK writes it. Clients still cannot create achievements. No rule change on the subcollection.

| # | Doc id | Tile | Unlock | Read from |
| --- | --- | --- | --- | --- |
| 1 | `first_session` | First | Finish 1 game | `gamesPlayed >= 1` |
| 2 | `first_win` | Win | Win 1 game | `wins >= 1` |
| 3 | `five_straight` | Five | Best streak reaches 5 | `bestWinStreak >= 5` |
| 4 | `shutout` | Shutout | Win without taking a letter | `cleanWins >= 1` |
| 5 | `from_the_brink` | Comeback | Win after peaking at S.K.A.T. | `comebackWins >= 1` |
| 6 | `fifty_landed` | Fifty | Land 50 tricks | `tricksLanded >= 50` |
| 7 | `hundred_landed` | Hundred | Land 100 tricks | `tricksLanded >= 100` |
| 8 | `letterman` | Letters | Give 25 letters | `lettersGiven >= 25` |
| 9 | `regular` | Regular | Finish 25 games | `gamesPlayed >= 25` |
| 10 | `the_whistle` | Whistle | Rule on at least one turn as the accepted judge | `turnsJudged >= 1` |
| 11 | `good_eye` | Good Eye | The community sides with you 3 times | `disputesRight >= 3` |
| 12 | `consistent` | Steady | Land at least 20 tricks, and land at least half of your attempts | `tricksLanded >= 20` and `tricksLanded * 2 >= tricksLanded + tricksFailed` |

`five_straight` is the early step. The Economy badge `streak10` stays the 10-win badge and keeps the name Streak. `hundred_landed` is tricks landed. Century stays "100 games." `good_eye` is the disputer being right (`disputesRight` increments on a bail verdict). It is not "you cast a vote." There is no vote counter on the profile. A tile for "cast 5 votes" would need a new counter; it is not in this 12.

`the_whistle` uses `turnsJudged`, which the close-out already fills from `judgedBy`. A declined or pending invite never gets that tally. `gamesJudged` also increments when an accepted judge is merely listed on a forfeit, including one they never ruled, so the ribbon waits for a real ruling.

Grants happen in the close-out transaction. Reads happen before writes, which the Admin SDK requires. Read an achievement doc only when the new counters meet its line, then create it if it is missing. A retry of the transaction is safe because `statsApplied` still gates the whole close-out, and a present doc is left alone so `earnedAt` stays honest.

Backfill can create the same docs from the replayed totals. It writes `earnedAt` from the game that crossed the line. It does not notify anyone.

## Where it is written

### Games, judge credit, daily caps, achievements

All of that goes in `applyGameStats`, in the transaction that already:

- re-reads the game
- bails out when `statsApplied === true`
- reads the winner, loser, and judge profiles before any write
- sets `statsApplied: true`
- increments the existing counters

Add the XP writes to that same transaction. `xp` is an absolute number (`previous + award`), not `FieldValue.increment`, because `level`, `xpDay`, and the two "earned today" fields have to agree with the new total. A concurrent close-out on the same profile aborts and retries, which is the same reason `currentWinStreak` is already an absolute write.

Existing counters (`wins`, `gamesPlayed`, `tricksLanded`, and the rest) stay on `FieldValue.increment`. This feature does not change their meaning.

Zero XP is still a successful close-out. `statsApplied` still flips, so an empty forfeit does not retry forever.

`onGameCompleted` stays the trigger. It gains two params, same pattern as dice in `functions/src/index.ts`:

| Param | Default | Effect |
| --- | --- | --- |
| `XP_ENABLED` | `false` | When false, only uids in `XP_TESTER_UIDS` get XP writes. Everyone else's close-out is byte-for-byte the current one. |
| `XP_TESTER_UIDS` | empty | Comma-separated Firebase uids. A tester earns XP on their own side of a game while the switch is off. A non-tester on the other side does not. |

Both files that change (`index.ts`, `applyGameStats.ts`, plus their tests) are already on the allowlist.

### Dispute votes

A vote is not a game-end event. The dispute closes in the middle of a game, inside `api/cron/resolve-expired-disputes.ts`, which already runs as Admin SDK and already writes user counters. That transaction is already idempotent: `dispute.status === "closed"` or `resolutionApplied === true` returns before any write.

Vote XP is paid there, in that same transaction, once.

- Query `disputeVotes` where `disputeId` equals this dispute, limit 30. One vote per person is already enforced by the `{uid}_{disputeId}` doc id. Thirty is enough for the current player base and stays inside a transaction.
- Those reads happen before the existing writes.
- For each voter, read their profile (same "reads first" rule) and add 10, plus 5 when their `verdict` matches a final `land` or `bail`. Apply the referee daily cap. Write absolute `xp`, `level`, `xpDay`, and `xpRefToday`.
- The client update rule on `disputes` only allows `landVotes` or `bailVotes` to change. A voter cannot set their own XP while voting, and cannot clear the close-out.

This is the one XP write that does not live in `applyGameStats`. It is the same split the dispute counters already have: game totals in the close-out, dispute totals in the referee. Putting vote XP on game-end would make a voter wait until the game finishes, and a game that stalls would never pay them. The cron path is under `api/`, so the Cloud Functions allowlist does not apply to it.

The two writers both absolute-write `xp` inside transactions on the user doc. Firestore serializes those, retries the loser, and the second attempt reads the first attempt's total. Do not mix `FieldValue.increment` on `xp` with a `level` computed from a stale read.

### Backfill

Games that already have `statsApplied: true` will not enter the close-out again. Historical XP has to be written by a script, the same way `scripts/backfill-stats.mjs` rebuilt wins.

`scripts/backfill-xp.mjs` (new, Admin SDK, `--dry-run` first):

1. Read every game with status `complete` or `forfeit`. The wins backfill already holds that set in memory; this script can too.
2. Sort by `updatedAt`. Replay each game through the same pure award function the close-out uses, including empty-forfeit, real-forfeit, the 24-hour account age, the same-opponent day counter, the daily first, and both caps. The game's `updatedAt` is the UTC day.
3. `SET` each user's `xp` and `level` to the replayed total. Set, not increment.
4. Create any of the 12 achievement docs the replayed counters cross. Skip docs that already exist.
5. Do not pay historical dispute votes. Those votes have no profile counter, and this replay does not walk `disputeVotes`. Votes start paying the day the referee code ships.

The script is safe to run again because it sets a total from the full replay. The last quiet run is the one that counts. A game that finishes between the read and the write can be missed or, if the live function also paid it, briefly doubled. A second run after things are quiet replaces that with the replayed total. Run it while `XP_ENABLED` is still false, then turn the switch on. Testers who already earned live XP should be excluded from the set, or their live total gets replaced by history.

The counter shortcut (`gamesPlayed * 40 + wins * 25 + …`) is a checksum for the dry run, not the writer. It overpays forfeit wins and ignores the caps. A large gap between the checksum and the replay is worth a look before the live run.

## Data model

### On `users/{uid}` (public profile, server-written)

| Field | Type | Meaning |
| --- | --- | --- |
| `xp` | number | Lifetime XP. Source of truth. Absent means 0. |
| `level` | number | 1..30, rewritten whenever the server writes `xp`. The chip and the bar display `levelForXp(xp)`, not this cache, so a stale write cannot show a level the XP does not support. Absent `xp` displays as level 1. |
| `xpDay` | string | UTC date `YYYY-MM-DD` the "today" buckets belong to. |
| `xpPlayToday` | number | Play XP already kept today. |
| `xpRefToday` | number | Referee XP already kept today. |

`xp` and `level` are public on purpose, the same way `wins` is public. `xpDay` and the two today-buckets sit on the same doc because that is where the owner-immutable list already lives. They tell a signed-in reader how much XP this profile banked today. That is not sensitive. Moving them to `users/{uid}/private/profile` would be worse: that doc is owner-writable, so the owner could zero the cap.

### `xpPairs/{uidA}_{uidB}`

Server-only. `utcDay`, `count`. No client rule. Default deny.

### `users/{uid}/achievements/{id}`

Unchanged shape. New ids from the table above.

### Rules

Measured while writing this doc: `firestore.rules` is **200,050 bytes / 3,366 lines**, **76.3%** of Firebase's 256 KB (262,144 byte) limit, about 62 KB left. `docs/GAPS.md` P2-9 asked us to keep additions small. This design adds field names to two existing lists and adds no `match` block.

On **create** of `users/{uid}`, same zero-seed treatment as `wins` (the comment in the rules already says a counter missing from this list is mintable at signup):

- `xp` absent or `0`
- `level` absent or `1`
- `xpPlayToday` absent or `0`
- `xpRefToday` absent or `0`
- `xpDay` absent

On **owner update**, add those five names to the `affectedKeys().hasAny([...])` backstop next to `wins` and `gamesPlayed`. That is the whole rules change. Rules tests follow the existing self-inflate red-team file: a signup cannot start at level 30, and a stance edit cannot smuggle an `xp` bump.

`xpPairs` and the achievement shape need no new rules.

## UI

The client flag is `VITE_FEATURE_XP_ENABLED`, literal `"true"` only, default off, parsed by the same `parseFlag` helper as dice. Off means the profile and the game-over screen look exactly as they do today. Extras are already on in production (the launch freeze lifted 2026-10-10). This flag is separate, the way `VITE_FEATURE_DICE_ENABLED` is separate. Turning extras on must not show a level.

Wire it through `src/lib/featureFlags.ts`, `src/lib/env.ts`, and `src/vite-env.d.ts`, and add it to `.env.example`.

### Level chip

`LevelChip` stops ignoring its prop. It renders `L{n}` for `n` clamped to 1..30, and the `aria-label` stays `Level {n}`. `ProfileIdentityCard` mounts it beside the username again, on your profile and on anyone else's, when the flag is on. The level it shows comes from `levelForXp(profile.xp)`.

### Progress bar

On the profile, under the identity card, when the flag is on. One line, for example `134 / 360 XP`. The denominator is `xpToReach(next level)`. At level 30 the bar is full and the line reads `Level 30`. The bar is public, same as the chip. No new fetch: `xp` is on the profile doc the screen already loads.

### Level-up moment

`GameOverScreen` receives `auth.activeProfile`, which is loaded at sign-in and is not a live listener. The close-out runs after the game doc updates, so the new XP is not in that prop.

When the flag is on, the game-over screen refetches the signed-in user's profile a few times over about ten seconds (the function cold-starts). If `levelForXp` of the refetched `xp` is higher than `levelForXp` of the profile the screen opened with, show a short moment: the chip, then `Level 4`. If this game also created ribbon docs, one line under it names up to three of them (`Whistle unlocked`). Then the existing rematch and back actions are what you can press. `prefers-reduced-motion` skips the movement and still shows the new level.

The refetch writes back into the auth profile state so opening the profile afterwards shows the new chip without a pull-to-refresh. If the refetch fails, skip the moment. The profile shows the truth on the next load. Do not invent a level on the client from the game you just watched. The server total is the only source.

Backfill does not fire this moment.

### Ribbon

When the flag is on, mount `AchievementsRibbon` on the profile again, under `BadgesRow`. The screen already fetches `users/{uid}/achievements` for the badge row. The ribbon filters that list to the 12 ids. No second listener.

A locked tile keeps the grayscale, the lock icon, and a real short name (`Five`, `Whistle`). It no longer says `???`. The accessible name is the short name plus the unlock line from the table (`Five, locked. Best win streak reaches 5.`). An unlocked tile drops the lock, drops the grayscale, and uses the same orange treatment as the level chip. Unknown ids stay out of the ribbon. `BadgesRow` keeps skipping ids it does not know, so a ribbon grant does not appear as a broken badge chip.

The ribbon shows on any signed-in view of a profile, matching the badge row. Signed-out visitors already skip the achievements fetch. Leave that as it is.

## Rollout

Functions are not deployed by CI. Merging the implementation later deploys rules only if the rules file changed (`firebase-rules-deploy.yml`). The function itself is a hand deploy, the same rule as dice in `docs/DICE.md` and the stats close-out in `docs/DEPLOYMENT.md`.

Do it in this order:

1. **Rules.** Deploy the five new field names. Behavior does not change. Clients still cannot write them, and nothing writes them yet.
2. **Function, by hand, switch off.**

   ```bash
   firebase use sk8hub-d7806
   firebase deploy --only functions:onGameCompleted
   ```

   Set `XP_ENABLED=false` and `XP_TESTER_UIDS` to the tester uids. `defineBoolean` / `defineString` prompt on deploy (or read `functions/.env.sk8hub-d7806`, which is not committed). Confirm the region is still `us-central1`, matching the `skatehubba` database.
3. **Referee.** Deploy the dispute cron only when you want testers to earn vote XP. Until that deploy, votes pay nothing and the rest of XP still works. Gate the vote writes on the same `XP_ENABLED` / `XP_TESTER_UIDS` pair so a production cron deploy does not pay every voter early.
4. **Preview client.** A Vercel preview with `VITE_FEATURE_XP_ENABLED=true`. Production stays unset, so production keeps today's profile.
5. **Watch testers.** Play a real game, an empty forfeit, a second game against the same person, and one dispute vote. `xp` on their user doc should match the table. A non-tester in a game against a tester gets stats as today and no `xp` field.
6. **Backfill.** Dry run, read the summary, then live, excluding tester uids. Then set `XP_ENABLED=true` and redeploy `onGameCompleted` by hand.
7. **Production client.** Set `VITE_FEATURE_XP_ENABLED=true` in Vercel and redeploy. This is the step that shows the chip, the bar, the moment, and the ribbon to everyone.

Turning the client flag on before step 6 shows existing players at level 1 until the backfill lands. Turning the function on before the rules deploy is safe (the Admin SDK bypasses rules) and is still the wrong order, because a client on an old build could write `xp` until the backstop exists. Rules first.

## Files the implementation PR touches

No new file under `functions/src/`.

| File | Change |
| --- | --- |
| `functions/src/applyGameStats.ts` | Award function, caps, pair counter, achievement grants, absolute `xp` / `level` |
| `functions/src/applyGameStats.test.ts` | The table pins, forfeit, same-opponent, cap, age, idempotency |
| `functions/src/index.ts` | `XP_ENABLED`, `XP_TESTER_UIDS`, passed into the close-out |
| `functions/src/index.test.ts` | Switch off leaves a non-tester profile unchanged |
| `api/cron/resolve-expired-disputes.ts` | Vote XP inside the existing resolution transaction |
| `firestore.rules` | Five names, create zero-seed and update backstop |
| `rules-tests/users-stats-selfinflate-redteam.rules.test.ts` | Cannot mint or bump the new fields |
| `src/constants/xp.ts` | The 30-row table and `levelForXp` |
| `src/lib/featureFlags.ts`, `src/lib/env.ts`, `src/vite-env.d.ts`, `.env.example` | The client flag |
| `src/services/users.ts` | The five fields on `UserProfile` |
| `src/components/LevelChip.tsx` | Honor the prop |
| `src/screens/PlayerProfileScreen/components/ProfileIdentityCard.tsx` | Chip plus the progress bar |
| `src/screens/PlayerProfileScreen/components/AchievementsRibbon.tsx` | Real 12, locked and unlocked |
| `src/screens/PlayerProfileScreen/index.tsx` | Mount them when the flag is on |
| `src/screens/GameOverScreen.tsx` | Refetch and the level-up moment |
| `scripts/backfill-xp.mjs` | The replay |

## Open questions

Plain versions of the calls above. The default is what this doc specifies. A different answer changes the implementation, so these want an explicit yes or a replacement number.

1. **Do the point values feel right?** Default: the play and referee tables. A finished win with a few lands is a bit over 100 XP, which is level 2. Judging a game is 30 plus 5 a turn.

2. **Is 300 play XP a day the right ceiling?** Default: 300, with 80 for referee XP. That is about two full games against different people. A third game that day gets partly cut. Say if a real session at a spot is often three or four games, and the play cap should be 400 instead.

3. **The third game against the same person on the same day pays nothing. Is that too harsh for two friends skating together?** Default: first game full, second game half, third and after nothing. They can skate someone else, or wait for the next UTC day, and the filmed tricks still count toward wins and the ribbon. Only the XP is cut.

4. **Should a brand-new account earn XP?** Default: no play XP unless both accounts were created at least 24 hours before the game was. This slows a same-day alt pair. It also slows two real people who both signed up at the spot and played immediately. Referee XP still pays either way.

5. **When should a dispute vote pay out?** Default: when the dispute closes, in the referee job that already writes `disputesRight`. Paying at the moment of the tap would be a client write. Paying at game end would leave the voter waiting, and a stalled game would never pay.

6. **Should an achievement also dump a pile of XP?** Default: no. The ribbon tile is the reward. XP comes only from the earning table, so the level curve stays predictable and a backfill unlock cannot jump someone a level by surprise.

7. **At level 30, does the number stop?** Default: the chip stays at 30 and XP keeps counting past 50,750. If you later want level 40, the extra XP is already there.

8. **Do games people already finished count?** Default: yes. One admin script replays them through these rules and sets XP, then you flip the switch. Old dispute votes do not pay. Everyone starts at the level their real games earn, and the daily caps apply to that history because the script walks the games in order.

9. **Locked tiles: show the name, or keep the question marks?** Default: show the short name and the lock, and put the exact requirement in the screen-reader label (`Five, locked. Best win streak reaches 5.`). The current `???` was for a placeholder with no real list behind it.

10. **Is Good Eye the right dispute tile?** Default: yes. The community sided with you 3 times, which is `disputesRight` and needs no new counter. The alternative is "cast 5 votes," which needs a vote counter the profile does not have. Leave that counter out of v1.

11. **Should the chip show on other people's profiles?** Default: yes. Level is public reputation, like wins. The progress numbers are public too.

12. **Does Roll Dice ever grant XP?** Default: no. Dice has its own win/loss docs and never enters this close-out. Mixing them would make a dice streak count as skating.
