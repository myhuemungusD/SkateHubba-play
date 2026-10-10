# XP and Levels

**Status:** Revised after Jason's review. Design only. Nothing here is implemented.
**Owner:** Jason. This is the sign-off `docs/STATS.md` asks for before Tier 3.
**Unblocks:** the level chip and the achievements ribbon.

What changed from the first draft, in the words of that review:

- Scoring is four rules a player can remember. Shutouts, comebacks, letters, and the daily-first bonus are gone from XP. Shutouts and comebacks are achievements instead.
- The daily cap is a high safety rail. The real limit is repeated games against the same person.
- The climb is longer: 50 levels, and a player who finishes 3 games a day still takes a bit over 3 years to reach the top.
- The ribbon is the front of a larger set, about 36 achievements in bronze / silver / gold, with a See All view.

## What already exists

| Piece | Today |
| --- | --- |
| `src/components/LevelChip.tsx` | Hard-coded `L1`. The `level` prop is ignored. The file comment clamps at 30. This design moves that clamp to 50. |
| `ProfileIdentityCard` | The chip was removed from the profile because every account showed the same L1. |
| `AchievementsRibbon` | Draws 12 locked tiles (`???` plus a lock). It is not mounted. A placeholder on a live profile was called an unfinished product, so it stays off until this ships. |
| `BadgesRow` | Mounted. Shows docs under `users/{uid}/achievements` that it recognizes. The five Economy Phase A badges are Century (100 games), 150 Club (150 wins), OG, Streak (10 wins in a row), and Pioneer. |
| Stats close-out | `functions/src/applyGameStats.ts`, called from `onGameCompleted`. One transaction per terminal game, guarded by `games/{id}.statsApplied`. |
| Dispute stats | `api/cron/resolve-expired-disputes.ts` writes `tricksDisputed`, `disputesRaised`, `disputesRight`, and `disputesWrong` when a community dispute closes. There is no per-user count of votes cast. |

`docs/ECONOMY.md` stays a different system. Phase A is badges and the Locker. Phase B is Hubba Bucks. XP does not spend, does not buy a badge, and does not convert into Hubba Bucks. This close-out does not grant `century`, `club150`, `og`, `streak10`, or `pioneer`. Those stay Phase A grants with their own ids, so a ribbon tier at a similar number cannot collide with them. Dice stays out: dice games live in `diceGames`, and `onGameCompleted` never sees them.

## Why the server writes it

In July 2026 a client replay (`GameContext.fanOutStats`) corrupted production wins and losses. The fix moved those counters into `applyGameStats`. Firestore rules list every server-owned field in `affectedKeys().hasAny([...])`. A new counter missing from that list can be minted at signup.

XP is that kind of counter. The client reads it. The close-out writes it in the transaction that already flips `statsApplied`.

The CI allowlist (`verify-no-cloud-functions` in `.github/workflows/pr-gate.yml`) already permits edits to:

- `functions/src/index.ts`
- `functions/src/index.test.ts`
- `functions/src/applyGameStats.ts`
- `functions/src/applyGameStats.test.ts`
- `functions/src/dice/*.ts`

This build adds no file under `functions/src/`. The gate does not change. `applyGameStats.ts` is 331 lines today, under the soft 400-line budget. If the XP math pushes it over 400, that is a warning. Splitting a new `functions/src/xp.ts` would fail the gate until you sign off on an allowlist edit, so the math stays in the allowlisted file.

`functions/tsconfig.json` compiles only `functions/src`. The function cannot import the app's `src/constants/`. The level formula below is integer arithmetic, so the function and the client can each carry a copy without float drift. Tests pin level 2 = 160, level 10 = 12,960, and level 50 = 384,160.

## The four rules

All figures are integers. Halves round down.

| Rule | Who | XP |
| --- | --- | --- |
| Finish a game | Both players | 50 |
| Win it | The winner, and only when status is `complete` | 50 |
| Land a trick | The matcher who landed it | 10 each |
| Make a call | The accepted judge, per turn they actually ruled, and anyone whose dispute vote is still there when that dispute closes | 10 each |

That is the whole earning list. A shutout, a comeback, a letter you handed out, and "first game today" pay nothing extra. Those moments show up as achievements.

A setter's own set is not a landed trick. A miss pays the person who missed nothing. Trick counts come from the `deriveGameStats` walk over `turnHistory` that the close-out already does.

A call is one number on purpose. There is no flat fee for being listed as judge, and no extra for voting the way the dispute ended. Being right is an achievement candidate (`disputesRight` already exists) and is not in the 36 below. The two players still cannot vote on their own dispute.

### One game

A beats B. Status `complete`. A landed 4 tricks. B landed 2. First game between them today. Both accounts are older than a day.

- A: 50 finish + 50 win + 40 landed = **140**
- B: 50 finish + 20 landed = **70**
- A judge who ruled 2 turns: **20**
- A person whose vote stood when a dispute in that game closed: **10**, paid when the dispute closed, not at the tap and not at the final game screen

## Anti-farming

The filmed trick is still the main brake. These rules cover what is left. They are not part of the four things a player has to memorize, except "an empty forfeit pays nothing."

Applied in this order:

1. **Empty forfeit.** Status `forfeit` and `turnHistory` has fewer than 2 entries. Pay 0 to both players and to the judge. The only forfeit path today is the 24-hour turn deadline. "Empty" means the game never became a skate.

2. **Forfeit after real skating.** Status `forfeit` and the history has 2 or more entries. Pay the 50 finish and the landed tricks. Do not pay the 50 win. The game ended because someone disappeared, not because they were skated out.

3. **New accounts.** If either player's `createdAt` is missing, or is less than 24 hours before the game's `createdAt`, pay 0 play XP to both (finish, win, lands). Calls still pay. Creating a game already requires a verified email. This extra day is for a pair of accounts made the same afternoon. It does not see two accounts on one phone.

4. **Same two people, same UTC day.** Doc `xpPairs/{uidA}_{uidB}` with the uids sorted, so they share one counter. Fields: `utcDay` and `count`. This multiplies finish, win, and land XP for both of them. Calls are not cut.
   - 1st game that day: 100%
   - 2nd: 50%
   - 3rd: 25%
   - 4th and after: 0%

   Playing a different person pays full. That is the point of aiming the limit at the pair, not at how many games you play.

5. **Safety cap.** **3,000 XP per UTC day**, one bucket, play and calls together. Leftover above the cap is dropped.

   A heavy day is a dozen games against different people. A win with 4 lands is 140, so twelve of those are 1,680, and even a long jam around fifteen to twenty games stays under 3,000. The cap is there for a broken loop, not for a normal session. Someone who hits it is past a full day of filming.

An empty forfeit does not count as a game against that person for the pair counter, and it does not use up the cap.

## How fast a level moves

The pace math uses one kind of game, over and over: status `complete`, win half the time, land 3 tricks, a different opponent, an account older than a day, no calls.

That game is 50 + 25 + 30 = **105 XP**.

| Player | Pace | XP |
| --- | --- | --- |
| Casual | 3 games a week | about 315 XP a week, about 16,400 a year |
| Active | 3 games a day | about 315 XP a day, about 115,000 a year |

Calls, hotter win rates, and more lands move these up. The same-opponent taper moves them down. The estimates below use 105 and nothing else.

## The curve

50 levels. Level 1 is 0 XP.

```
xpToReach(1) = 0
xpToReach(L) = 160 × (L − 1)²     for L from 2 to 50
```

Squares stay exact in both the function and the client. No exponent to recompute. A player's level is the highest `L` with `xpToReach(L) <= xp`, and it never goes past 50. XP past 384,160 still accumulates. The chip stays at L50.

The step from one level to the next is `160 × (2L − 3)`. Level 2 costs 160 (about two games). Level 50 costs 15,520 (about seven weeks of the active pace, for that one level).

Times below are rounded. "Casual" is the 3-games-a-week player. "Active" is the 3-games-a-day player.

| Level | Total XP | This level | Casual | Active |
| ---: | ---: | ---: | --- | --- |
| 1 | 0 | 0 | start | start |
| 2 | 160 | 160 | under a week | under a day |
| 3 | 640 | 480 | 2 weeks | 2 days |
| 4 | 1,440 | 800 | 5 weeks | 5 days |
| 5 | 2,560 | 1,120 | 2 months | 8 days |
| 6 | 4,000 | 1,440 | 3 months | 2 weeks |
| 7 | 5,760 | 1,760 | 4 months | 3 weeks |
| 8 | 7,840 | 2,080 | 6 months | 4 weeks |
| 9 | 10,240 | 2,400 | 7 months | 5 weeks |
| 10 | 12,960 | 2,720 | 9 months | 6 weeks |
| 11 | 16,000 | 3,040 | 12 months | 7 weeks |
| 12 | 19,360 | 3,360 | 14 months | 2 months |
| 13 | 23,040 | 3,680 | 17 months | 2.4 months |
| 14 | 27,040 | 4,000 | 20 months | 2.8 months |
| 15 | 31,360 | 4,320 | 23 months | 3.3 months |
| 16 | 36,000 | 4,640 | 2.2 years | 3.8 months |
| 17 | 40,960 | 4,960 | 2.5 years | 4.3 months |
| 18 | 46,240 | 5,280 | 2.8 years | 4.8 months |
| 19 | 51,840 | 5,600 | 3.2 years | 5.4 months |
| 20 | 57,760 | 5,920 | 3.5 years | 6 months |
| 21 | 64,000 | 6,240 | 3.9 years | 6.7 months |
| 22 | 70,560 | 6,560 | 4.3 years | 7.4 months |
| 23 | 77,440 | 6,880 | 4.7 years | 8.1 months |
| 24 | 84,640 | 7,200 | 5.2 years | 8.8 months |
| 25 | 92,160 | 7,520 | 5.6 years | 9.6 months |
| 26 | 100,000 | 7,840 | 6.1 years | 10 months |
| 27 | 108,160 | 8,160 | 6.6 years | 11 months |
| 28 | 116,640 | 8,480 | 7.1 years | 12 months |
| 29 | 125,440 | 8,800 | 7.6 years | 13 months |
| 30 | 134,560 | 9,120 | 8.2 years | 14 months |
| 31 | 144,000 | 9,440 | 8.8 years | 15 months |
| 32 | 153,760 | 9,760 | 9.4 years | 16 months |
| 33 | 163,840 | 10,080 | 10 years | 17 months |
| 34 | 174,240 | 10,400 | 11 years | 18 months |
| 35 | 184,960 | 10,720 | 11 years | 19 months |
| 36 | 196,000 | 11,040 | 12 years | 21 months |
| 37 | 207,360 | 11,360 | 13 years | 22 months |
| 38 | 219,040 | 11,680 | 13 years | 23 months |
| 39 | 231,040 | 12,000 | 14 years | 2.0 years |
| 40 | 243,360 | 12,320 | 15 years | 2.1 years |
| 41 | 256,000 | 12,640 | 16 years | 2.2 years |
| 42 | 268,960 | 12,960 | 16 years | 2.3 years |
| 43 | 282,240 | 13,280 | 17 years | 2.5 years |
| 44 | 295,840 | 13,600 | 18 years | 2.6 years |
| 45 | 309,760 | 13,920 | 19 years | 2.7 years |
| 46 | 324,000 | 14,240 | 20 years | 2.8 years |
| 47 | 338,560 | 14,560 | 21 years | 2.9 years |
| 48 | 353,440 | 14,880 | 22 years | 3.1 years |
| 49 | 368,640 | 15,200 | 22 years | 3.2 years |
| 50 | 384,160 | 15,520 | 23 years | 3.3 years |

Reading the bands:

| You reach | Total XP | Casual | Active |
| --- | ---: | --- | --- |
| Level 2 | 160 | the first week | the first day |
| Level 10 | 12,960 | about 9 months | about 6 weeks |
| Level 20 | 57,760 | about 3.5 years | about 6 months |
| Level 30 | 134,560 | about 8 years | about 14 months |
| Level 50 | 384,160 | about 23 years | about 3.3 years |

An active player is past a year at level 27 and takes a bit over three years to hit the cap, playing 3 games a day the whole way. A casual player is level 10 inside a year and spends many years in the 20s and 30s.

## Achievements

36 tiles. Twelve families, three tiers each: bronze, silver, gold. They pay no XP.

The profile ribbon shows **12 tiles**: the bronze of each family, locked or unlocked. **See All** opens the full set, grouped by family, with silver and gold on the same row as the bronze. The 12-tile component stays the front door. It does not try to fit 36 squares on the profile.

Grants are docs at `users/{uid}/achievements/{id}` with the shape the rules already pin: `{ earnedAt, reason }`, reason at most 200 characters. The Admin SDK writes them. Clients still cannot create them. Ids below are new. They are not `century`, `club150`, `streak10`, or `pioneer`.

"Existing" means the close-out or the dispute referee already maintains the counter. "New" means this feature adds it. New counters are still server-written, and each name goes on the rules backstop.

### Games, wins, streaks, lands

| Family | Bronze | Silver | Gold | Counter |
| --- | --- | --- | --- | --- |
| Games | 10 games `games_10` | 50 `games_50` | 250 `games_250` | `gamesPlayed`, existing |
| Wins | 10 wins `wins_10` | 100 `wins_100` | 500 `wins_500` | `wins`, existing |
| Streak | best streak 3 `streak_3` | 5 `streak_5` | 10 `streak_10` | `bestWinStreak`, existing |
| Lands | 50 tricks `lands_50` | 250 `lands_250` | 1,000 `lands_1000` | `tricksLanded`, existing |

Century is 100 games and 150 Club is 150 wins, so those badges sit between ribbon tiers and stay on `BadgesRow`. Streak gold is the same "10 in a row" as the Economy Streak badge, with a different doc id, so both can exist and this close-out only writes `streak_10`.

### Shutout and comeback

These left the XP table and live here. Both counters already exist. A shutout is `cleanWins` (you won without taking a letter). A comeback is `comebackWins` (you peaked at 4 letters, S.K.A.T., and still won). The threshold in code is `COMEBACK_LETTER_THRESHOLD = 4`.

| Family | Bronze | Silver | Gold | Counter |
| --- | --- | --- | --- | --- |
| Shutout | 1 `shutout_1` | 10 `shutout_10` | 25 `shutout_25` | `cleanWins`, existing |
| Comeback | 1 `comeback_1` | 5 `comeback_5` | 20 `comeback_20` | `comebackWins`, existing |

### Referee and votes

| Family | Bronze | Silver | Gold | Counter |
| --- | --- | --- | --- | --- |
| Whistle | rule 1 turn `whistle_1` | 25 turns `whistle_25` | 100 turns `whistle_100` | `turnsJudged`, existing |
| Votes | 1 vote that stood `votes_1` | 25 `votes_25` | 100 `votes_100` | `disputeVotesCast`, **new** |

`turnsJudged` comes from `judgedBy` on the turn history. A judge who is only listed, and never rules, does not move it. `gamesJudged` does increment for an accepted judge on a forfeit they never ruled, so the ribbon uses `turnsJudged`.

`disputeVotesCast` does not exist yet. The dispute referee counts votes still on the dispute when it closes (same transaction that already writes `disputesRight`, limit 30 votes) and adds that many to each voter's counter. One vote per person is already enforced by the vote doc id. Historical votes are filled by the backfill, not by reopening closed disputes.

`disputesRight` (the community sided with the person who raised the dispute) is a different idea from "you cast a vote." It is not one of the 36. It is cheap to add later as a 13th family because the counter is already there.

### People, spots, clips

| Family | Bronze | Silver | Gold | Counter |
| --- | --- | --- | --- | --- |
| Opponents | 5 different people `opponents_5` | 25 `opponents_25` | 100 `opponents_100` | `uniqueOpponents`, **new** |
| Spots | finish a game at 1 spot `spots_1` | 5 spots `spots_5` | 20 spots `spots_20` | `spotsPlayed`, **new** |
| Home spot | 1 finished game at a spot you created `homespot_1` | 10 `homespot_10` | 50 `homespot_50` | `gamesAtMySpots`, **new** |
| Clips | post 1 clip `clips_1` | 10 `clips_10` | 50 `clips_50` | `clipsPosted`, **new** |

How the new ones move:

- **`uniqueOpponents`.** On a terminal game that is not an empty forfeit, the close-out writes a marker `users/{uid}/xpMarkers/opp_{opponentUid}` the first time and increments the counter only then. The same person forever counts as one.
- **`spotsPlayed`.** Same idea with `users/{uid}/xpMarkers/spot_{spotId}`, and only when the game has a `spotId`. A game with no spot does not count. Empty forfeits do not count.
- **`gamesAtMySpots`.** When the game has a `spotId`, the close-out reads that spot. If `createdBy` is this player, add 1. Repeat games at your own spot count. This is the simple version of Pioneer. The Pioneer badge itself stays a Phase A grant and is not written here. The same pair can grind this counter; their XP is still tapered. The achievement is "games happened at your spot."
- **`clipsPosted`.** User-uploaded clips (`source: "user"`) are created by the client. There is no server hook on that write, and a new Cloud Function for it would need an allowlist change. The counter moves with a rules-bound +1 in the same transaction as the clip create: the owner's `clipsPosted` may go up by exactly 1, and any other change is denied. Same idea as `upvoteCount` on a clip. The achievement *doc* is written by the next `applyGameStats` run for that user (it reads the counter and grants whatever tier it has crossed), and by the backfill for clips that already exist. A player who posts a 10th clip and does not finish another game sees the doc land on the next game, not on the upload. See All can light the tile from the counter immediately so the wait is only the permanent doc.

`xpMarkers` is one subcollection, one rules block: clients cannot create or edit, the owner can delete so account erasure still works. Deleting a user today walks `achievements` and `locker` in `src/services/users.ts` and `api/account/_deleteUserData.ts`. Those two walks gain `xpMarkers`. A marker left behind is a profile the deletion missed.

Games at a spot, and clips, are the two that are easy to describe and slightly more work than a counter we already have. Both are called out so they can be dropped without touching the other 30.

## Where it is written

### Games

Inside `applyGameStats`, in the transaction that already re-reads the game, bails out when `statsApplied` is true, reads both profiles and the judge, then sets the flag and increments the existing counters.

`xp` is an absolute write (`previous + award`), because `level`, `xpDay`, and `xpToday` have to match the new total. A concurrent update retries. Existing counters stay on `FieldValue.increment`. This feature does not change what wins, lands, or `turnsJudged` mean.

Zero XP is still a successful close-out. An empty forfeit still flips `statsApplied`.

`onGameCompleted` gains two params, same pattern as dice:

| Param | Default | Effect |
| --- | --- | --- |
| `XP_ENABLED` | `false` | When false, only uids in `XP_TESTER_UIDS` get the new fields. Everyone else's close-out stays as it is today. |
| `XP_TESTER_UIDS` | empty | Comma-separated uids. A tester earns on their own side. The other player, if not a tester, does not. |

`index.ts` and `applyGameStats.ts` are already on the allowlist.

### Votes

Vote XP and `disputeVotesCast` are written in `api/cron/resolve-expired-disputes.ts`, in the transaction that already closes the dispute. That transaction returns immediately when `status` is `closed` or `resolutionApplied` is true, so a retry cannot pay twice. Vote reads happen before the writes. The path is under `api/`, so the Cloud Functions allowlist does not apply.

Both writers absolute-write `xp` inside a transaction on the user doc. Firestore serializes them. Do not mix `FieldValue.increment` on `xp` with a level computed from a stale read.

### Backfill

Games that already have `statsApplied: true` will not enter the close-out again. `scripts/backfill-xp.mjs` (Admin SDK, `--dry-run` first):

1. Read every `complete` and `forfeit` game. Sort by `updatedAt`. Replay through the same award function, including empty forfeits, real forfeits, the 24-hour account rule, the pair taper, and the 3,000 cap. The game's `updatedAt` is the UTC day.
2. `SET` `xp` and `level`. Set, not increment.
3. Rebuild `uniqueOpponents`, `spotsPlayed`, and `gamesAtMySpots` from that replay. Set `disputeVotesCast` from a scan of `disputeVotes`. Set `clipsPosted` from user-source clips.
4. Create any of the 36 docs the counters have crossed. Skip docs that already exist. `earnedAt` for game-based tiers comes from the game that crossed the line.
5. Do not pay XP for historical votes or historical clips. Those counts unlock achievements. They do not invent XP the four rules would not have paid on a game.

The last quiet run wins, because it sets a total from the full replay. Run it while `XP_ENABLED` is still false, and exclude tester uids so a live tester total is not replaced by history. A checksum for the dry run, not the writer, is `gamesPlayed × 50 + wins × 50 + tricksLanded × 10`. It ignores forfeits and the pair taper, so a large gap is worth a look.

## Data model

### On `users/{uid}`

| Field | Meaning |
| --- | --- |
| `xp` | Lifetime XP. Source of truth. Absent means 0. |
| `level` | 1..50, rewritten with `xp`. The chip displays `levelForXp(xp)`. Absent `xp` displays as level 1. |
| `xpDay` | UTC date `YYYY-MM-DD` that `xpToday` belongs to. |
| `xpToday` | XP already kept today, play and calls together. |
| `uniqueOpponents` | Distinct opponents faced in a non-empty game. |
| `spotsPlayed` | Distinct spots with a finished non-empty game. |
| `gamesAtMySpots` | Finished non-empty games at a spot this user created. |
| `disputeVotesCast` | Votes still present when the dispute closed. |
| `clipsPosted` | User-uploaded clips. Rules-bound +1. |

`xp` and `level` are public, the same way wins are public. The today-bucket sits on the same doc because that is where the owner-immutable list already lives. It tells a signed-in reader how much XP this profile kept today. Moving it to the private profile would let the owner zero the cap, because that doc is owner-writable.

### Other paths

- `xpPairs/{uidA}_{uidB}` — server-only, default deny, no new rule block.
- `users/{uid}/xpMarkers/{id}` — one subcollection for opponent and spot markers. Owner delete, no client create or update.
- Achievement docs — unchanged shape, new ids.

### Rules

Measured for the first draft, and unchanged since: `firestore.rules` is **200,050 bytes / 3,366 lines**, **76.3%** of the 256 KB limit, about 62 KB left. `docs/GAPS.md` P2-9 is why this stays small.

On **create** of `users/{uid}`, zero-seed every new counter (absent or 0), `level` absent or 1, and `xpDay` absent. The rules comment already says a counter missing from that list is mintable at signup.

On **owner update**, add the nine names to the `affectedKeys().hasAny([...])` backstop, with one exception carved for `clipsPosted`: it may increase by exactly 1 in the same write as a new user-source clip whose `playerUid` is the caller. Any other change to it is denied.

Add one `xpMarkers` match block, owner-delete only.

That is the rules change. No new top-level `match` for `xpPairs`. Rules tests follow the existing self-inflate file: a signup cannot start at level 50, and a stance edit cannot smuggle an `xp` bump. A second test covers the clip +1, including a rejected +5.

The clip exception is the only part that adds real rules logic. If that pushes the compiled rules over the size limit or the evaluation-node ceiling (already hit once in this file), ship the other 33 achievements and hold the Clips family. Do not expand the rules to chase it.

## UI

Client flag: `VITE_FEATURE_XP_ENABLED`, literal `"true"` only, default off, same `parseFlag` helper as dice. Off means the profile and the game-over screen look as they do today. Extras are already on in production. This flag is separate. Wire it through `src/lib/featureFlags.ts`, `src/lib/env.ts`, `src/vite-env.d.ts`, and `.env.example`.

### Level chip

`LevelChip` uses its prop, clamped to 1..50. The accessible name stays `Level {n}`. `ProfileIdentityCard` shows it beside the username, on your profile and on anyone else's, when the flag is on. The number is `levelForXp(profile.xp)`.

### Progress bar

Under the identity card when the flag is on. One line, for example `140 / 640 XP`, where 640 is the total required for the next level. At level 50 the bar is full and the line reads `Level 50`. Public, same as the chip. No new fetch.

### Level-up moment

`GameOverScreen` gets `auth.activeProfile`, loaded at sign-in, not a live listener. The close-out runs after the game doc updates.

When the flag is on, the screen refetches that profile a few times over about ten seconds. If the new `xp` maps to a higher level than the profile the screen opened with, show the chip and `Level 4`. If this game also created achievement docs, one line names up to three of them (`Shutout unlocked`). Rematch and back stay usable. `prefers-reduced-motion` skips the movement and still shows the new level.

The refetch writes back into auth profile state so the profile chip is current without a pull-to-refresh. A failed refetch skips the moment. The client does not invent a level from the game it just watched.

### Ribbon

When the flag is on, mount `AchievementsRibbon` under `BadgesRow`. The screen already loads `users/{uid}/achievements`. The ribbon filters that list to the 12 bronze ids. See All is a second view on the same list, plus the silver and gold ids, grouped by family.

A locked tile keeps the grayscale and the lock, and shows the short name (`10 wins`, `Shutout`) instead of `???`. The accessible name includes the requirement (`Shutout, locked. Win a game without taking a letter.`). An unlocked tile drops the lock and uses the same orange as the level chip. Bronze, silver, and gold are a label under the name, not color alone.

Unknown ids stay out of the ribbon. `BadgesRow` keeps skipping ids it does not know, so a ribbon grant does not show up as a broken badge.

Signed-in viewers see the ribbon, matching the badge row. Signed-out visitors already skip the achievements fetch.

## Rollout

Functions are not deployed by CI. The function is a hand deploy, same as dice (`docs/DICE.md`) and the stats close-out (`docs/DEPLOYMENT.md`).

1. **Rules.** The new field names, the clip +1, and `xpMarkers`. Nothing writes XP yet.
2. **Function, by hand, switch off.**

   ```bash
   firebase use sk8hub-d7806
   firebase deploy --only functions:onGameCompleted
   ```

   Set `XP_ENABLED=false` and `XP_TESTER_UIDS` to the tester uids. Confirm the region is still `us-central1`.
3. **Referee.** Deploy the dispute cron when testers should earn the 10 XP per vote. Until then, votes pay nothing and the other three rules still work. Gate those writes on the same switch and tester list.
4. **Preview client.** `VITE_FEATURE_XP_ENABLED=true` on a Vercel preview. Production stays unset.
5. **Watch testers.** One real game, one empty forfeit, a second and third game against the same person the same day, a game against someone else, and one dispute vote.
6. **Backfill.** Dry run, then live, excluding tester uids. Then set `XP_ENABLED=true` and redeploy `onGameCompleted` by hand.
7. **Production client.** Set the Vite flag in Vercel and redeploy. That is the step that shows the chip, the bar, the moment, and the ribbon to everyone.

Rules go out before the function. The Admin SDK bypasses rules, but an old client can write `xp` until the backstop exists.

## Files the implementation PR touches

No new file under `functions/src/`.

| File | Change |
| --- | --- |
| `functions/src/applyGameStats.ts` | The four rules, pair taper, cap, markers, achievement grants |
| `functions/src/applyGameStats.test.ts` | Table pins, forfeit, pair taper, cap, age, idempotency |
| `functions/src/index.ts` | `XP_ENABLED`, `XP_TESTER_UIDS` |
| `functions/src/index.test.ts` | Switch off leaves a non-tester unchanged |
| `api/cron/resolve-expired-disputes.ts` | Vote XP and `disputeVotesCast` |
| `firestore.rules` | Nine names, clip +1, `xpMarkers` |
| `rules-tests/users-stats-selfinflate-redteam.rules.test.ts` | Cannot mint or bump the new fields |
| `src/constants/xp.ts` | `160 × (level − 1)²` and `levelForXp` |
| `src/lib/featureFlags.ts`, `src/lib/env.ts`, `src/vite-env.d.ts`, `.env.example` | The client flag |
| `src/services/users.ts` | New fields on `UserProfile`, and `xpMarkers` in account deletion |
| `api/account/_deleteUserData.ts` | Sweep `xpMarkers` |
| `src/components/LevelChip.tsx` | Honor the prop, clamp 1..50 |
| `src/screens/PlayerProfileScreen/components/ProfileIdentityCard.tsx` | Chip and progress bar |
| `src/screens/PlayerProfileScreen/components/AchievementsRibbon.tsx` | 12 bronzes, See All for the 36 |
| `src/screens/PlayerProfileScreen/index.tsx` | Mount them when the flag is on |
| `src/screens/GameOverScreen.tsx` | Refetch and the level-up moment |
| `scripts/backfill-xp.mjs` | The replay |

## Open questions

The review settled the shape: four rules, a high cap, pair-based anti-farm, a longer 50-level climb, and a tiered set with See All. These are the calls still worth a yes or a different number.

1. **Are 50 / 50 / 10 / 10 the right four numbers?** Default: yes. Finish 50, win 50, each land 10, each call 10. A normal win with a few lands is about 140 XP, which is just under level 2. Level 2 takes about two games.

2. **Is 3,000 a day the right safety rail, or should there be no hard cap at all?** Default: keep 3,000. A heavy day of games against different people does not hit it. The pair taper is what stops two friends from farming. Say if you would rather delete the cap entirely.

3. **Is the pair taper right?** Default: first game against that person today pays full, second pays half, third pays a quarter, fourth and after pay nothing. Playing someone else pays full again.

4. **A forfeit after real skating pays the finish and the lands, and does not pay the win. Good?** Default: yes. An empty forfeit still pays nothing, and a brand-new pair of accounts still gets no play XP for the first day. Those two stay.

5. **Past level 50, does XP stop?** Default: the chip stays at 50 and XP keeps counting past 384,160, so a later level 60 does not need a second backfill.

6. **Do games people already finished count?** Default: yes. One admin script replays them through these rules and sets XP, then the switch flips on for everyone. Old votes and old clips count toward those achievements and do not add XP.

7. **The clip badge waits for the next finished game to write the permanent doc. Is that acceptable?** Default: yes, and See All lights the tile from `clipsPosted` right away. The alternative is a new Cloud Function on clip upload, which means an allowlist change. If the rules-bound +1 fails the rules size check, hold the whole Clips family and ship the other 33.

8. **Locked tiles: show the name, or keep the question marks?** Default: show the short name and the lock. The requirement goes in the screen-reader label.

9. **Should the chip show on other people's profiles?** Default: yes. Level is public, like wins.

10. **Add a 13th family for "the community sided with you"?** Default: no. That counter (`disputesRight`) already exists, and it can be a later bronze/silver/gold (1 / 10 / 25) without a new field. The 36 above treat voting as "you cast one," which is the new `disputeVotesCast` counter.

11. **Does Roll Dice grant XP?** Default: no. Dice never enters this close-out.
