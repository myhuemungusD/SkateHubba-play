# Roll Dice

Street dice between two skaters: C-Lo, 4-5-6, Craps and 10,000. A match is a race to a target score. It is not S.K.A.T.E.: games live in `diceGames`, records and Rep live in `diceStats`, and `onGameCompleted` never sees them.

There is no gambling: no chips, no wallets, nothing to buy or cash out. Points only decide the match.

## What is off until you turn it on

Two switches, and both start off.

| Switch                      | Where                             | Default | What it does                                                                                                                                                    |
| --------------------------- | --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_FEATURE_DICE_ENABLED` | Vercel env, inlined at build time | unset   | Shows `/dice`, `/dice/new`, `/dice/:gameId`, the lobby card, and the profile button. Anything except the literal `true` keeps the app looking as it does today. |
| `DICE_ENABLED`              | Cloud Functions param             | `false` | When false, `diceAction` rejects every caller who is not in `DICE_TESTER_UIDS`.                                                                                 |
| `DICE_TESTER_UIDS`          | Cloud Functions param             | empty   | Comma-separated Firebase uids. Both players in a test match must be listed, or the opponent's roll is rejected.                                                 |

The scheduled `diceSweep` does not check the kill switch. Tester matches still close when a turn expires.

## Deploy

Merging to `main` deploys Firestore rules and indexes only (`firebase-rules-deploy.yml`). The dice rules are read-only for clients, so that deploy does not turn the game on. It also does not deploy functions.

Use Actions → **Deploy Firebase Functions** on `main`. Set `functions` to `diceAction,diceSweep` and `confirm` to `deploy`. See `docs/DEPLOY_FUNCTIONS.md`.

Or from a laptop:

```bash
firebase use sk8hub-d7806
firebase deploy --only functions:diceAction,functions:diceSweep
```

On that deploy, set:

```text
DICE_ENABLED=false
DICE_TESTER_UIDS=<your uid>,<the other tester's uid>
```

`defineBoolean` / `defineString` prompt for these (or read them from `functions/.env.<projectId>`, which is not committed). Leave `DICE_ENABLED` false until you want every signed-in, verified user to be able to call.

Then build a preview with the client flag, not production:

```text
VITE_FEATURE_DICE_ENABLED=true
```

Redeploy that preview. Production stays on the default (flag unset) until you are ready for everyone.

App Check on `diceAction` is monitor-only (`enforceAppCheck: false`), matching `docs/APPCHECK_ROLLOUT.md`. A missing token is logged as `dice_appcheck` and the call still runs.

## How a match runs

1. **Challenge.** The challenger picks a game and a length on `/dice/new` (or from a profile's Roll Dice button). The match starts `pending`. The opponent gets a notification and can accept or decline. The challenger can call it off. A pending challenge expires after 24 hours. None of these touch records or Rep.
2. **Play.** Both seats roll on the server through `diceAction`. Turns last 24 hours with one reminder 3 hours before the deadline. The waiting player can nudge once an hour.
3. **End.** First to the target wins (`complete`, end reason `target`). Leaving after the match started, or running out of time, is a `forfeit`. Both count for records and Rep.
4. **After.** Either player can send a rematch: same game, same length. A second tap opens the same rematch instead of making another.

## Points

| Game   | Dice | Targets         | How points come                                                                                                                                                      |
| ------ | ---- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-Lo   | 3    | 5 or 9          | Both roll each round; best hand takes it. 4-5-6 = 3, trips = 2, winning on a point = 1. A tie replays the round.                                                     |
| 4-5-6  | 3    | 5 or 9          | C-Lo hands, but 4-5-6 or trips win on the spot (3 / 2) and 1-2-3 loses on the spot (1 to the other skater). Points still have to be beaten. Round openers alternate. |
| Craps  | 2    | 5 or 9          | One hand each, alternating. Natural 7/11 = 1, making your point = 2, making a hard 4 or 10 = 3. Craps or seven-out = 0.                                              |
| 10,000 | 6    | 5,000 or 10,000 | Standard farkle scoring. Set aside scoring dice, roll the rest or bank. A farkle loses the turn's points. Hot dice rolls all six again.                              |

**Equal turns.** In Craps and 10,000 the first shooter can reach the target first, so the other skater always gets the same number of hands. If both are at or over the target after equal hands, the higher score wins; a tie plays on.

**Rep** is an Elo rating: everyone starts at 1,000, K = 32, floor 100, and a winner always gains at least 1. Only decided matches move it (`complete`, or `forfeit` after the match started). `diceStats` also keeps wins, losses, games played, peak Rep, the current win streak and the best streak, plus per-game counts.

**Old matches.** v1 documents (endless C-Lo rounds) load on both client and server as C-Lo races to 5, with rounds already won counted as points.

## Rules of the table

Hand scoring is the Got Em implementation (`clo.ts`, `craps.ts`, `farkle.ts` in `functions/src/dice/`), copied unchanged. The server rolls every die with a secure random source, scores every hand and owns every score; the client's copies in `src/screens/Dice/diceRules.ts` only drive labels and the 10,000 keep preview.

Turns last 24 hours, same as S.K.A.T.E. Challenges use the same verified-email, ban, and block checks. The server rolls the dice. Clients cannot write `diceGames`, `diceStats`, or `diceCreateLimits`.

## Testing

- Unit: `functions/src/dice/*.test.ts` (engine, scoring, Rep, transitions, handlers) and `src/**/__tests__` for the screens.
- Rules: `npm run test:rules`.
- Push: `functions/src/dice/pushContract.test.ts` runs the challenge, accept, turn, nudge and reminder pushes through the real push courier (`functions/src/push/drain.ts`) and checks the exact FCM message. FCM itself and the banner on a phone can only be checked on a device.
- End to end: `npm run test:e2e:dice` plays every game as both players at 390×844, plus decline, call off, nudge, forfeit, timeout, offline and the slow reveal, and checks the notification docs for challenge, accept, turn, nudge and result. It starts auth, firestore, storage and functions emulators with the dice switches on for that run only (it writes `DICE_ENABLED=true` to the gitignored `functions/.env.demo-skatehubba` if the file is missing). It waits out the server's cooldowns rather than retrying, and fails on any rejected dice call. `DICE_SHOTS=<dir>` saves screenshots; extra arguments go to Playwright (`npm run test:e2e:dice -- -g Craps`).
- CI: the `e2e-dice` job in `.github/workflows/main.yml` runs the same script. To save Actions minutes it runs on pushes to main and on PRs that touch dice files, the functions entry point or push code, the rules, the lockfiles, Playwright config or e2e helpers.

**Error copy.** The callable answers with a dice code (`slow_down`, `bad_keep`, `create_cooldown`, ...); cooldowns add `retryAfterMs` in the error details. The Firebase SDK hands the code back as `"slow_down [400]"`, so `diceErrorInfo` in `src/services/dice.ts` strips the status before matching. Before that fix every rejection showed the generic "That didn't work. Try again."
