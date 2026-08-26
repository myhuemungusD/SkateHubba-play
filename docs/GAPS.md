# SkateHubba Gap Analysis & Prioritization

**Date:** 2026-08-21
**Scope:** `SkateHubba-play` (full audit) + `DesignMainline` (static-site pass)
**Method:** Five parallel code audits (roadmap-vs-code, rules/service parity, test coverage, security/infra/ops, code-quality/UX), plus the full `npm run verify` gate. Highest-severity findings were re-verified by hand against source. Line references are `file:line` at the audited commit (`5091db4`).

The verify gate is **green** end to end (`tsc -b`, lint, coverage thresholds, build, test-dup all pass). The gaps below are things the gate does not catch: security-rule holes, a silent gameplay dead-end, missing compliance controls, doc drift, and coverage/observability blind spots.

---

## Priority model

| Tier   | Meaning                                                                             | Act            |
| ------ | ----------------------------------------------------------------------------------- | -------------- |
| **P0** | Exploitable security hole, active user-facing breakage, or a hard external deadline | Fix now        |
| **P1** | Real defect or compliance gap with no clean workaround; ships bad state to users    | Fix this cycle |
| **P2** | Correctness/observability/quality gap that will bite under load or on-call          | Schedule       |
| **P3** | Doc drift, hygiene, cosmetic                                                        | Batch/backlog  |

Every item lists the evidence so it can be picked up cold.

---

## P0 — Fix now

### P0-1 · `clipVotes` bare delete has no paired decrement → unbounded upvote inflation

**Status: CLOSED** — fixed in `e7ef1a8` (delete now carries its paired counter decrement, with orphan/zero-floor/legacy escapes; red-team suite `rules-tests/clipvotes-delete-stuffing-redteam.rules.test.ts` covers the full stuffing cycle). Verified green against the emulator 2026-08-26.

**Security hole. Feed ranking is corruptible from a single account.**
`firestore.rules:2918-2919` allows `delete` on a clip vote with only an owner check. The CAST branch of `clipVoteDeltaOk` (`firestore.rules:207-211`) only checks `!exists → existsAfter`. So `cast(+1) → deleteDoc(voteRef) → cast(+1) → …` adds +1 to `clips.upvoteCount` every lap, forever. The client already has the bare-delete path (`src/services/clips.votes.ts:316-318`).
**Fix:** port the `disputeVotes` delete clause verbatim — it already solves exactly this (`firestore.rules:3169-3193`, confirmed present: requires the same write to decrement the counter, with zero-floor and orphan escapes). Add a rules-test for the stuffing loop (current test `rules-tests/clips.rules.test.ts:572-585` only covers count==0).

### P0-2 · Storage game-video path can be squatted → forged forfeit wins

**Status: CLOSED** — fixed in `3afa0d0` (game-video filenames pinned to `{role}-{uploaderUid}.{ext}` by exact-string equality, so no account can occupy another player's path; squat tests in `rules-tests/storage-redteam.rules.test.ts` "path squatting" block). Verified green against the emulator 2026-08-26.

**Security hole. Deterministic griefing.**
`storage.rules:10-32` lets any signed-in user `create` at `games/{gameId}/{turnPath}/{fileName}` with no game-membership check, `update` is `if false`, and `delete` requires the object's own `uploaderUid`. An opponent who knows `gameId` pre-creates `turn-{n}/set.webm|mp4` and `match.webm|mp4` with their own uid. The victim's `uploadVideo` (`src/services/storage.ts:301-330`) then hits `update` → denied permanently; they can't set a trick, the deadline expires, and the squatter takes the forfeit win (`firestore.rules:1784-1829`). Not covered by the storage red-team suites (they only test overwrite of an already-occupied path).
**Fix:** encode uid in the path segment, or add a Firestore-backed membership signal. Add a fresh-path squat test.

### P0-3 · `pendingReview` transition fires no notification → the 24h dispute window is silent

**Active user-facing breakage. A shipped feature silently defeats itself.**
When a matcher claims a land on the honor path, `src/services/games.match.ts:216-222` writes `phase: "pendingReview"` + `reviewDeadline` and **writes no notification** — the in-code comment says it's "DEFERRED." Every other branch in that file notifies (`:60,:113,:180,:304,:317,:430`). `notifications.ts:32` has no dispute-related `NotificationDocType`. The setter is never told a claim is waiting on their 24h accept/dispute decision; they find out only if they happen to open the lobby, otherwise the window expires and `api/cron/resolve-expired-disputes.ts` auto-accepts. Same silence on `disputes.raise.ts` (claimer isn't told their land was disputed).
**Fix:** add a `dispute_pending` / `dispute_raised` `NotificationDocType` and `writeNotificationInTx` calls in both transitions, plus push. (Verified by hand: the branch returns `outcome: "pending_review"` which is consumed nowhere in the repo.)

### P0-4 · DSA compliance: zero controls, hard Feb 17 deadline with external lead time

**Compliance blocker. The trader/DUNS items cannot be compressed at the deadline.**
Repo-wide grep for `dsa|illegal content|statement of reasons|appeal|trusted flagger|trader|d-u-n-s` returns nothing across `docs/`, `src/`, `fastlane/`. The app ships to Apple and Google. The `dsa-compliance-checkpoint` skill tracks a **Feb 17** gate. The account-level items — Apple Individual→Organization conversion, D-U-N-S issuance (days-to-weeks), DSA point-of-contact — bear external lead time and block submission regardless of code.
**Fix (start immediately, non-code):** kick off D-U-N-S + Apple org conversion now; designate a DSA point of contact (Art. 11/12) in `TermsOfService.tsx`. Code items in P1-5.

---

## P1 — Fix this cycle

### P1-1 · `notBanned()` missing from six UGC write surfaces

`firestore.rules:76-77` claims a banned account "loses **every** UGC-producing write." Actually enforced on only 3 paths (user clips `:2766`, comments `:2832`, clipVotes `:2871/:2909`). **Missing** on: `disputes` create (`:2945`), `disputeVotes` create (`:3136` — these write _binding_ letters/turn order), `spots/{id}/comments` (`:2068`), `spots` create (`:1983`), `reports` create (`:2525`), game-source `clips` create (`:2702`). Only the `/games` omission is a documented budget exception (`:79-84`). Red-team suite covers 3 of 9 surfaces.

### P1-2 · `users` create not bound to a `usernames` reservation → username uniqueness bypass

`firestore.rules:331-420` validates username _shape_ but never requires a companion `usernames/{name}` write; `:863-874` gates the reservation but never cross-checks the profile. The client always writes both (`src/services/users.ts:340-360`), but a direct API call can create `users/{uid}` with `username:"famous_pro"` and skip the reservation. `/games` create then binds denormalized handles to `get(users/{uid}).username` (`:1150-1153`), propagating the forged handle authoritatively.
**Fix:** require `getAfter(usernames/{username}).uid == request.auth.uid` on user create (the file already uses this idiom in `clipRateLimitOk`, `:172-178`).

### P1-3 · `player1/2IsVerifiedPro` are client-writable and unvalidated → badge forgery

`src/services/games.create.ts:136-137` sets these client-side; the `/games` create rule has no `keys().hasOnly()` allowlist (`:1030-1031`) and never validates them. Any user can self-stamp `player1IsVerifiedPro:true` and show as Verified Pro to every opponent (`WaitingHeader.tsx:41`, `useLobbyController.ts:82`, `LetterScoreboard.tsx:35`). (Hand-verified.)
**Fix:** pin against `get(users/{uid}).isVerifiedPro`, or add a `keys().hasOnly()` to `/games`.

### P1-4 · Games/spots creation cooldowns are trivially bypassable

`firestore.rules:1165-1169` (games) and `:2021-2025` (spots) read `lastGameCreatedAt`/`lastSpotCreatedAt` with `get()` (pre-state); the advancing write is fire-and-forget on the client (`games.create.ts:168-176`, `spots.ts:268`). A client that never writes the anchor never trips the cooldown. The file flags the asymmetry itself (`:166-169`).
**Fix (one line each):** add `getAfter(users/{uid}).data.lastGameCreatedAt == request.time`, mirroring `clipRateLimitOk()`.

### P1-5 · DSA notice-and-action mechanism is materially incomplete (code)

The report/ban infrastructure is above-average as abuse tooling (`reports.ts`, `firestore.rules:2518-2597`, `ReportModal` on 4 surfaces) but incomplete as DSA compliance:

- **No illegal-content category** — reason enum is `inappropriate_video|abusive_behavior|cheating|spam|non_skate_content|other` (`reports.ts:6-12`, `firestore.rules:2545`). No Art. 16 illegal-content notice path; signed-in-only (`:2523`) so a non-user who spots illegal content has no route.
- **No receipt/decision notice to reporter** (Art. 16(4-5)) — `submitReport` writes nothing back; close-out `hasOnly` (`:2587`) structurally prevents attaching a notification.
- **No Art. 17 statement of reasons** — `bans.reason` is optional free text (`:845-849`); content removal produces no uploader notice (`clips.cascade.ts`).
- **No Art. 20 appeal path** — rules structurally preclude one (`:854-856`, `:2586`, `:2594`); an appeal needs a new collection, not a rule relaxation.
- **Clip comments not reportable** — `ReportModal` is not wired into `ClipComments.tsx`; `submitReport` already accepts `clipId`, so this is the cheapest fix.

### P1-6 · Unhandled rejection on Rematch → silent dead-end

`src/screens/GameOverScreen.tsx:40-52` — `try/finally` with **no catch**, wired directly as a click handler (`:203`). `onRematch` → `startChallenge` throws on reachable paths (`GameContext.tsx:199` "Cannot challenge this player." when either side blocked; plus Firestore rejections). Spinner clears via `finally`, nothing else happens, error only surfaces as an uncaught console rejection. Contrast `App.tsx:262-266` which wraps the same call.
**Fix:** add `catch` + surface a toast.

### P1-7 · Deleted/permission-denied active game is swallowed → frozen screen

`src/context/GameContext.tsx:156-158` ignores the `null` emission that `subscribeToGame` sends when the doc is gone (`games.subscriptions.ts:193-196`). A game deleted by admin/moderation cascade leaves the user parked on a frozen GamePlayScreen with no route out.
**Fix:** on `null`, route to lobby + toast.

### P1-8 · Three cron workflows have no failure alerting → silent P0 reintroduction

`sweep-expired-turns.yml`, `drain-push-dispatch.yml`, `resolve-expired-disputes.yml` have no `if: failure` / issue-open step. A red `sweep` run stops **all** turn-forfeiting silently (reintroducing the exact P0 the sweeper closed); a red `drain` stops **all** push. The correct pattern already exists in `firebase-rules-deploy.yml:305-333` (opens/closes a labelled tracking issue).
**Fix:** apply that failure-alert step to all three.

---

## P2 — Schedule

### P2-1 · `api/` has zero test-coverage floor and zero Sentry

`vite.config.ts:91` coverage `include` is `src/**` only. 2,947 lines of admin-SDK, internet-facing code (account erasure, cron sweepers) have **no coverage threshold** while React components have an 80% floor — the sharpest inconsistency in the repo. No `Sentry`/`captureException` anywhere in `api/`; every failure is `console.warn` into Vercel logs with no alert routing. A failed `account_delete_erasure_failed` (`delete.ts:288`) — a GDPR/store commitment — alerts nobody. `docs/SENTRY_ALERTS.md` has no server-side rules.

### P2-2 · No rate limiting on any `api/` endpoint → billing amplification

`GET /api/player-meta` is unauthenticated, always 200s, edge-cached per-uid (`player-meta.ts:196-221`), so enumerating random uids busts the cache every request → one Firestore read + one invocation each. `POST /api/account/delete` reaches `verifyIdToken` (`:238`) with no pre-throttle.

### P2-3 · App Check is OFF in production; failure mode is unmonitorable

`src/firebase.ts:141` — App Check is opt-in and disabled; `docs/APPCHECK_ROLLOUT.md:301-321` checklist is 18/18 unchecked. Firestore/Storage are unprotected against non-app traffic; every rules rate-limit is the only stand-in. Worse, `isAppCheckInitialized()` can report `true` while zero tokens mint (`firebase.ts:206-210`, `APPCHECK_ROLLOUT.md:33-40`) — the Apr 22 lockout signature — because there's no `getToken` probe. Native flag is baked into shipped binaries with no forced-update path (`android-aab.yml:73-74`).

### P2-4 · Rules tests don't run on `main` pushes or on non-rules PRs

`pr-gate.yml:152-192` runs `test:rules` only if the diff touches rules files; `main.yml` has no rules step. A PR changing `src/services/reports.ts` batch shape can break the `getAfter()` companion contract (`firestore.rules:2570-2571`) and pass every check, failing only at runtime as `permission-denied`. (Mitigated: `firebase-rules-deploy.yml` blocks deploy on a full emulator run.)

### P2-5 · No SAST / CodeQL / secret scanning in CI

11 workflows, none CodeQL/Semgrep/gitleaks. The stated threat model (`SECURITY.md:89`) includes AI agents pushing code, and the repo handles service-account JSON in env — a committed-secret scanner is the obvious missing control.

### P2-6 · Content moderation is avatar-only, client-side, and fail-open; video unscreened

`src/services/avatarModeration.ts:63-73,99-103` — on model-load failure `isAvatarSafe` resolves `{ok:true}` (fail-open); storage rules can't inspect pixels. It's client-side (skippable via direct upload). **`userClips/*` and game videos get zero proactive screening** — the primary content type of a video app has only reactive reports.

### P2-7 · Missing e2e coverage on high-risk flows

No e2e for: third-party judging, community dispute→verdict→tally, user-clip upload + downvote, admin ban/unban/award, **account deletion** (irreversible cascade). All have unit tests but no browser-level test. Also: `e2e/onboarding.spec.ts:131` is a permanent `test.fixme`; `e2e/helpers/__tests__/firestore-read.test.ts` is wired to no npm script or CI step (dead tests).

### P2-8 · Controller hooks escape the 100% hook coverage rule

~2,400 lines of stateful game/upload logic live next to components (`useGamePlayController.ts` 446 LOC, `useUserClipUpload.ts`, `useClipsFeedController.ts`, etc.) so they face the 80% UI floor, not the 100% `src/hooks/**` floor. No global coverage threshold means `src/context`, `src/lib`, `src/utils` can regress to 0%.

### P2-9 · `firestore.rules` at 74% of Firebase's hard limit, no size guard

189.5 KB / 256 KB, growing every feature; the per-evaluation node ceiling has already been hit once (`firestore.rules:880-895`). No CI check on rules size — failure mode is a deploy that hard-fails at the Firebase API. Add a size/complexity guard to `firebase-rules-deploy.yml`.

### P2-10 · Over-permissive rule content (spots URLs, missing hasOnly, unbounded strings)

`spots.photoUrls`/`obstacles` are type-only checked (`firestore.rules:2011-2015`), so arbitrary external URLs render as `<img src>` (`SpotPreviewCard.tsx:94-98`) — the exfil surface the clip video-pins were built to close. No `keys().hasOnly()` on six write-heavy collections (games, spots, clips×2, disputes, reports, nudges). `reports.reportedUsername` has no length cap (`:2530`) → ~1MB docs into the moderation queue. `reports`/`notifications` create lack `email_verified`.

---

## P3 — Batch / backlog

### P3-1 · Documentation describes a product two releases old (highest-value P3)

- **`GAME_MECHANICS.md` / `GAME_STATE_MACHINE.md` describe a state machine that no longer exists.** They say a landed claim "swaps roles immediately, no review" (`GAME_MECHANICS.md:58,142-145`); the code freezes into `pendingReview` with a 24h window (`games.match.ts:207-222`). The state tables omit `pendingReview`/`communityReview` (`games.mappers.ts:27`). These are the two docs a new contributor reads for the core loop.
- **`P0-SECURITY-AUDIT.md:187-224` declares a fixed P0 as still-open** (server-side turn timer — the sweeper exists at `api/cron/sweep-expired-turns.ts` + `sweep-expired-turns.yml`). A stale P0 hides that the risk closed and makes the whole doc untrustworthy.
- **ECONOMY.md + two service docstrings claim client writes are denied "outright"** for achievements/locker (`ECONOMY.md:34,62`; `achievements.ts:14`; `locker.ts:22`) — the rules actually allow `isAdmin()` _client_ writes (`firestore.rules:765,791`). Materially wrong security claim.
- **CHARTER §4.11 collection inventory is missing ~12 live collections** (disputes, disputeVotes, clipVotes, comments, pushTargets, push_dispatch×2, reports_limits, bans, achievements, locker).
- **CHARTER §4.12 approved-deps list omits three shipped prod deps** — `nsfwjs` (a TF-backed ML model, opposite of "keep the bundle lean"), `firebase-admin`, `@capacitor/keyboard`.
- **Whole shipped subsystems documented nowhere:** MFA, admin console, user clips + judging + comments, avatar NSFW moderation, My Stats. `DISPUTE_BINDING_DESIGN.md` is fully implemented but still labelled "DESIGN / APPROVED SCOPE."
- Stale figures: rules size cited ~half real (`CHARTER.md:186`); test suite cited "71 files / 761 tests" vs actual ~256 files (`STATUS_REPORT.md:141`).

### P3-2 · Storage lifecycle vs clips permanence — latent data loss

`infra/storage-lifecycle.json` deletes `games/` objects at 90 days, but clips reuse game video URLs (`clips.writes.ts:67,91` → `storage.ts:309`). Running `firebase-infra-setup.yml` with the lifecycle rule silently breaks every clip in the public feed and every `TurnHistoryViewer` replay at 90 days. Decide: exempt clip-backed videos, or accept feed decay — **before** anyone runs that workflow.

### P3-3 · Release hygiene

`package.json` still `1.1.0`, no git tags, and the CHANGELOG has **no `[Unreleased]` section at all** (only a dangling link at `:365`) despite ~25 merged feature commits and three docs citing that section as evidence. Cut the referee release tag (ROADMAP "Now" item #1) and reconstruct the changelog.

### P3-4 · File-length budget enforced nowhere; 10 files over

`check:file-length` is not in `verify` and only `continue-on-error` in `pr-gate.yml:146-150`. Worst: `Settings.tsx` (561/350), `Landing.tsx` (553/350), `AddSpotSheet.tsx` (391/250). `Settings.tsx` carries 3 independent effects that extract cleanly into hooks.

### P3-5 · Accessibility edges

`ToastContainer.tsx:7` returns `null` when empty and the `aria-live` region mounts with its text, so screen readers may drop game-critical toasts ("it's your turn"); render the live region persistently. `useFocusTrap.ts:40-41` handles only Tab, so 8 modals hand-roll Escape and the 9th will silently ship without it. (Icon-button labels, reduced-motion, and focus-trap coverage are otherwise clean.)

### P3-6 · Smaller correctness/hygiene

- Client clip-vote flip skips the decrement when drop counter is 0 (`clips.votes.ts:231-235`) but rule FLIP branch requires both deltas to move (`firestore.rules:226-232`) → whole tx denied. Client/rule divergence.
- `init_failed` 500 echoes raw `JSON.parse` message (may embed input snippet of the service-account key) — `sweep-expired-turns.ts:682`; match `delete.ts:228`'s flat "Server misconfiguration."
- `public/sw-cleanup.js:4-5` has 2 real lint errors, invisible because lint is scoped to `src/ api/`.
- `firebase.json:10-13` declares a `functions` predeploy that a bare `firebase deploy` would trip, contradicting the no-Cloud-Functions guardrail.
- `@tensorflow/tfjs` is an undeclared direct dep (auto-peer-installed via nsfwjs) → unmanaged by Dependabot, floating version, ships in bundle.
- `LevelChip.tsx` is a hardcoded `level = 1` stub already removed from its only call site — dead code.
- `guard-as-any-casts` / `guard-todo-fixme-hack` don't scan `api/` — the most privileged code can carry `as any` and TODOs unchecked.

### P3-7 · Verified NOT problems (no action)

- `lucide-react ^1.27.0` and `uuid ^14` **resolve cleanly** to `1.28.0` / `14.0.0` in both lockfile and `node_modules` — not bugs.
- `firebase-admin` in `dependencies` (not dev) is **correct** — Vercel builds `api/` from root; verified it doesn't leak into the client bundle.
- `games.create.ts:164` `setDoc` (not `runTransaction`) is **correct** — idempotent create at a deterministic id, not a state mutation.
- The `/games` turn-order / letter / deadline / stats-lockdown invariants are airtight and well-tested. `DISPUTE_BINDING_DESIGN.md` is fully implemented (only its status header is stale).

---

## DesignMainline (static marketing site)

Small static site; findings are minor.

- **D1 (P2) · Broken/missing image references.** `sleeves.html` references `/assets/sleeves/01.webp`–`06.webp` but only `01/02/03.webp` exist — `04/05/06` 404. `index.html` slideshow references `02-igrinder.jpg`, `03-skatehubba.jpg`, `04-studio.jpg` but `assets/slides/` contains only `01-originals.jpg` — three of four slides 404.
- **D2 (P3) · `/forge` is deployed but unlinked.** `SETUP.md` step 3 ("Link from the main site") was never done — `index.html` has zero `forge` references, so the paid tool has no entry point from the homepage.
- **D3 (P3) · Repo hygiene.** `2d to 3d generator.zip` (296 KB) and a `scraps/` napkin file are committed into the site root and deploy to production.
- **D4 (info) · Forge unlock is honor-system `localStorage`** — already documented as an accepted tradeoff in `SETUP.md`; noting only for completeness.

---

## Recommended sequence

1. **Today:** P0-1, P0-2, P0-4 (rules fixes are small and self-contained; DSA account tasks have external lead time — start the clock).
2. **This cycle:** P0-3 + P1-1..P1-8 (the notification gap, the banned-write surfaces, and cron alerting are the user-facing/abuse cluster).
3. **Schedule:** P2 block — `api/` observability + coverage, App Check rollout, moderation.
4. **Batch:** P3 doc rewrite (P3-1 first — the state-machine docs actively mislead), release hygiene, DesignMainline image fixes.

Nothing here blocks the current green build; everything here is what the green build doesn't see.
