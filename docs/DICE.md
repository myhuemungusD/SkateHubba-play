# Roll Dice

Street dice (C-Lo) between two skaters. A match is round after round until someone quits or a turn times out. It is not S.K.A.T.E.: games live in `diceGames`, lifetime wins and losses live in `diceStats`, and `onGameCompleted` never sees them.

There are no chips and no wallets in this version.

## What is off until you turn it on

Two switches, and both start off.

| Switch                      | Where                             | Default | What it does                                                                                                                                                    |
| --------------------------- | --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_FEATURE_DICE_ENABLED` | Vercel env, inlined at build time | unset   | Shows `/dice`, `/dice/new`, `/dice/:gameId`, the lobby card, and the profile button. Anything except the literal `true` keeps the app looking as it does today. |
| `DICE_ENABLED`              | Cloud Functions param             | `false` | When false, `diceAction` rejects every caller who is not in `DICE_TESTER_UIDS`.                                                                                 |
| `DICE_TESTER_UIDS`          | Cloud Functions param             | empty   | Comma-separated Firebase uids. Both players in a test match must be listed, or the opponent's roll is rejected.                                                 |

The scheduled `diceSweep` does not check the kill switch. Tester matches still close when a turn expires.

## Deploy (do this by hand)

Merging to `main` deploys Firestore rules and indexes only (`firebase-rules-deploy.yml`). The dice rules are read-only for clients, so that deploy does not turn the game on. Functions are not deployed by CI.

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

## Rules of the table

C-Lo scoring is the Got Em implementation (`functions/src/dice/clo.ts`), copied unchanged. 4-5-6 does not win the round until the other player has rolled, and a tie clears only the tied dice.

Turns last 24 hours, same as S.K.A.T.E. Challenges use the same verified-email, ban, and block checks. The server rolls the dice. Clients cannot write `diceGames`, `diceStats`, or `diceCreateLimits`.
