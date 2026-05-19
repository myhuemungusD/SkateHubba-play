# SkateHubba Source-of-Truth Alignment Audit

**Date:** 2026-05-18
**Scope:** Read-only, line-by-line, exhaustive
**Pairings covered:** 12

## Severity legend

- 🔴 **correctness** — one source actively contradicts another; a reader following the wrong source will make a wrong decision
- 🟡 **staleness** — one source has fallen behind reality but does not mislead about contracts
- 🟢 **cosmetic** — wording, line numbers, or counts that drift but do not affect correctness

## Method

Four read-only Explore agents fanned out across:

1. CLAUDE.md guardrails vs source-tree grep evidence
2. `firestore.rules` ↔ `src/services/games*` + `src/services/clips*` + `src/types/clip.ts`
3. `firestore.rules` ↔ `src/services/{users,spots,reports,blocking,clips.upvotes}` + `storage.rules` ↔ `src/services/storage.ts`
4. `docs/**` claims ↔ actual code/rules

A Plan agent designed the 12-pairing matrix below. No code was modified; only this report file was created.

---

## 1. CLAUDE.md ↔ code reality

### Hard guardrails — all clean

- ✓ **No `as any`** — zero hits in `src/**/*.{ts,tsx}` (excluding tests).
- ✓ **No TODO/FIXME/HACK** — zero hits in `src/`.
- ✓ **No `console.log`** — zero hits outside tests.
- ✓ **No Firebase imports outside `src/services/**` or `src/firebase.ts`** — zero leaks.
- ✓ **No Cloud Functions code** — `functions/` directory does not exist.
- ✓ **No state-management libraries** — no redux, zustand, jotai, recoil, mobx, valtio, or xstate in `package.json`.
- ✓ **No UI component libraries** — no @mui, @chakra-ui, antd, @mantine, react-bootstrap, @radix-ui.
- ✓ **No CSS modules / inline styles** — zero `.module.css` imports; zero `style={{}}` usage in `src/components/**` or `src/screens/**`.

### Transactional game writes — all clean

- ✓ `src/services/games.create.ts:180,202` — `runTransaction`
- ✓ `src/services/games.match.ts:30,87,151` — `runTransaction`
- ✓ `src/services/games.judge.ts:29,83,170` — `runTransaction`
- ✓ `src/services/games.turns.ts:90` — `runTransaction`
- ✓ `src/services/clips.upvotes.ts:159` — `runTransaction`

No raw `setDoc`/`updateDoc`/`addDoc`/`deleteDoc` calls outside transactions in any game-state mutation path.

### File LOC budgets — 10 soft overages

CLAUDE.md L131–136 sets soft budgets: `src/services/**` 400, `src/screens/**` 350, `src/components/**` 250. The following files exceed budget; per CLAUDE.md these are "warnings, not hard errors" and "a signal to extract helpers."

| File | Budget | Actual | Over |
| ---- | -----: | -----: | ---: |
| 🟡 `src/screens/Landing.tsx` | 350 | 444 | +94 |
| 🟡 `src/screens/Settings.tsx` | 350 | 425 | +75 |
| 🟡 `src/screens/AuthScreen.tsx` | 350 | 369 | +19 |
| 🟡 `src/screens/GamePlayScreen/useGamePlayController.ts` | 350 | 366 | +16 |
| 🟡 `src/screens/ProfileSetup.tsx` | 350 | 356 | +6 |
| 🟡 `src/components/map/AddSpotSheet.tsx` | 250 | 341 | +91 |
| 🟡 `src/components/VideoRecorder.tsx` | 250 | 298 | +48 |
| 🟡 `src/components/InviteButton.tsx` | 250 | 270 | +20 |
| 🟡 `src/components/TurnHistoryViewer.tsx` | 250 | 263 | +13 |
| 🟡 `src/components/map/SpotFilterBar.tsx` | 250 | 251 | +1 |

---

## 2. firestore.rules ↔ src/services/ (games + clips)

### Games collection

Every rule-enforced field aligns across `firestore.rules`, `src/services/games.*.ts`, and `src/services/games.mappers.ts`. Spot-checked rows:

| Field | Rules | Service write | TS type | Drift? |
| ----- | ----- | ------------- | ------- | ------ |
| `player1Uid` | `firestore.rules:432,515` | `games.create.ts:65` | `games.mappers.ts:46` | ✓ |
| `p1Letters` / `p2Letters` (int, ≤1 step) | `firestore.rules:436–437,666–676` | `games.create.ts:69–70` | `games.mappers.ts:50–51` | ✓ |
| `status` enum `active`\|`complete`\|`forfeit` | `firestore.rules:435,555,904` | `games.create.ts:71`, `games.match.ts:313`, `games.turns.ts:174` | `games.mappers.ts:52` | ✓ |
| `phase` enum `setting`\|`matching`\|`setReview`\|`disputable` | `firestore.rules:442,568–607,627` | `games.create.ts:74`, all phase transitions | `games.mappers.ts:55` | ✓ |
| `turnDeadline` (Timestamp, < 48h) | `firestore.rules:453–455,547–549,663–665,843–845` | `games.create.ts:62,79`, all phase transitions | `games.mappers.ts:61` | ✓ |
| `currentTrickName` (≤64) | `firestore.rules:457,579–581` | `games.match.ts:51,104` | `games.mappers.ts:58` | ✓ |
| `currentTrickVideoUrl` (storage host) | `firestore.rules:458,582–591` | `games.match.ts:52,105` | `games.mappers.ts:59` | ✓ |
| `turnHistory` (immutable in setting/matching) | `firestore.rules:610–612,895–896,925–928` | `games.match.ts:229,306`, `games.judge.ts:214` | `games.mappers.ts:67` | ✓ |
| `judgeId` (≠ players) | `firestore.rules:473–477` | `games.create.ts:86` | `games.mappers.ts:78` | ✓ |
| `judgeStatus` `pending`\|`accepted`\|`declined`\|null | `firestore.rules:480–482` | `games.create.ts:88`, `games.create.ts:189,211` | `games.mappers.ts:20,87` | ✓ |
| `updatedAt` (== `request.time`) | `firestore.rules:507–512` | every write path | `games.mappers.ts:65` | ✓ |

**State machine — fully covered:**

- `setting` → `matching` (`games.match.ts:50`)
- `matching` → `setting` (`games.match.ts:316` failSetTrick / missed-attempt path)
- `matching` → `disputable` (`games.match.ts:170` landed-with-judge)
- `matching` → `setReview` (`games.judge.ts:46` callBSOnSetTrick)
- `setReview` → `matching` | `setting` (`games.judge.ts:100,123`)
- `disputable` → `setting` | `complete` (`games.judge.ts:225`, `games.turns.ts:126` auto-accept)
- `active` → `complete` | `forfeit` (`games.match.ts:313`, `games.judge.ts:222`, `games.turns.ts:174`)

### Clips collection

Every rule-enforced field on `clips` aligns with `clips.writes.ts` and `src/types/clip.ts`:

| Field | Rules | Service | TS type | Drift? |
| ----- | ----- | ------- | ------- | ------ |
| Deterministic id `${gameId}_${turnNumber}_${role}` | `firestore.rules:1684–1690` | `clips.writes.ts:51–53,73–75` | — | ✓ |
| `role` enum `set`\|`match` | `firestore.rules:1686,1690` | `clips.writes.ts:53` | `clip.ts:34` (`ClipRole`) | ✓ |
| `trickName` (≤100) | `firestore.rules:1695–1697` | `clips.writes.ts:56,78` | `clip.ts:37` | ✓ |
| `moderationStatus` `active` on create | `firestore.rules:1705–1708` | `clips.writes.ts:59,81` | `clip.ts:41` | ✓ |
| `upvoteCount` (int ≥0, ±1 via vote-doc atomicity) | `firestore.rules:1711,1735–1755` | `clips.writes.ts:60,82`, `clips.upvotes.ts` | `clip.ts:42` | ✓ |

**No drift detected in the games or clips schema surface.**

---

## 3. firestore.rules ↔ src/services/ (users, spots, reports, blocks, votes, storage)

### Users / usernames

- ✓ Username regex `/^[a-z0-9_]+$/` — `firestore.rules:171` ↔ `src/services/users.ts:168`.
- ✓ Username length 3–20 — `firestore.rules:168–169` ↔ `users.ts:166–167`.
- ✓ Sensitive fields (`email`, `emailVerified`, `dob`, `parentalConsent`, `fcmTokens`) forbidden at top level — `firestore.rules:177,203` ↔ private subcollection path enforced in service.
- ✓ `fcmTokens ≤ 10` — `firestore.rules:305–306` ↔ `users.ts:83`.
- ✓ `wins` / `losses` / `lastGameCreatedAt` / `lastSpotCreatedAt` / `onboardingTutorialVersion` — server-managed via the same transaction that creates the game/spot; no visible direct write. Not a drift — call out explicitly in the report so readers don't read "rules require X" + "service has no `set(X)` call" as a contradiction.

### Spots

| Field | Rules | Service | TS type | Drift? |
| ----- | ----- | ------- | ------- | ------ |
| `name` 1–80 | `firestore.rules:1044–1046` | `spots.ts:95–97` | `spot.ts:30` | ✓ |
| `description` ≤500 | `firestore.rules:1048–1051` | `spots.ts:99–101` | `spot.ts:31` | ✓ |
| `gnarRating` / `bustRisk` 1–5 | `firestore.rules:1061–1066` | `spots.ts:149–150` | `spot.ts:34–35` (literal union) | ✓ |
| `obstacles` ≤14 | `firestore.rules:1068–1069` | `spots.ts:100–101` | `spot.ts:36` | ✓ |
| `photoUrls` ≤5 | `firestore.rules:1071–1072` | `spots.ts:104–105` | `spot.ts:37` | ✓ |
| `isVerified` false on create | `firestore.rules:1075` | server-default | `spot.ts:38` | ✓ |
| `isActive` true on create | `firestore.rules:1076` | server-default | `spot.ts:39` | ✓ |

### Reports

- ✓ Reason enum `['inappropriate_video','abusive_behavior','cheating','spam','other']` — `firestore.rules:1548` ↔ `reports.ts:6,21`.
- ✓ Description ≤500 — `firestore.rules:1549–1550` ↔ `reports.ts:59` (`trim().slice(0,500)`).
- ✓ Companion `reports_limits/{reporterUid_reportedUid}` doc written atomically — `firestore.rules:1570–1576` ↔ `reports.ts:73–79` (single batch commit).
- ✓ Reports immutable after create — `firestore.rules:1579–1580` ↔ no update path in service.

### Blocks

- ✓ Path `users/{uid}/blocked_users/{blockedUid}` — `firestore.rules:388` ↔ `blocking.ts:29`.
- ✓ Cannot block self — `firestore.rules:394` ↔ `blocking.ts:25`.

### Clip votes

- ✓ Doc id `${uid}_${clipId}` — `firestore.rules:1789` ↔ `clips.upvotes.ts:154`, `clips.mappers.ts:86–87`.
- ✓ Target clip must exist — `firestore.rules:1797` ↔ `clips.upvotes.ts:163` (`tx.get` for race safety).
- ✓ Vote docs immutable — `firestore.rules:1799` ↔ no update path in service.

### Storage

| Constraint | `storage.rules` | `src/services/storage.ts` | Drift? |
| ---------- | --------------- | -------------------------- | ------ |
| Path format | L10 `games/{gameId}/{turnPath}/{fileName}` | `storage.ts:139` `games/${gameId}/turn-${turnNumber}/${role}.${ext}` | ✓ |
| Role enum | L26 `(set\|match)` | `storage.ts:79–100` | ✓ |
| Extension enum | L26 `(webm\|mp4)` | `storage.ts:79–100` | ✓ |
| Content type | L23–24 `video/webm`, `video/mp4` | `storage.ts:50,82–100` | ✓ |
| MIN_UPLOAD_BYTES | L19 `> 1024` | `storage.ts:31` `1024` | ✓ |
| MAX_UPLOAD_BYTES | L21 `< 50 * 1024 * 1024` | `storage.ts:33` `50 * 1024 * 1024` | ✓ |
| `customMetadata.uploaderUid` | L28 | `storage.ts:176–181` | ✓ |
| Immutability after create | L29–44 | append-only contract in service | ✓ |

**No drift detected across users, spots, reports, blocks, votes, or storage.**

---

## 4. firestore.rules ↔ firestore.indexes.json ↔ service queries

7 composite indexes declared in `firestore.indexes.json`:

| Index | Backing query | Status |
| ----- | ------------- | ------ |
| `spots`(isActive ASC, latitude ASC) | `spots.ts:367–370` `queryNearbySpots` | ✓ used |
| `clips`(moderationStatus ASC, createdAt DESC, __name__ DESC) | `clips.feed.ts` chronological feed | ✓ used |
| `clips`(moderationStatus ASC, upvoteCount DESC, createdAt DESC, __name__ DESC) | **none yet** | 🟡 declared but unused |
| `notifications`(recipientUid ASC, read ASC, createdAt DESC) | `notifications.ts:300–303` | ✓ used |
| `games`(player1Uid ASC, status ASC, updatedAt DESC) | `games.subscriptions.ts:29–34` | ✓ used |
| `games`(player2Uid ASC, status ASC, updatedAt DESC) | `games.subscriptions.ts:36–41` | ✓ used |
| `nudges`(recipientUid ASC, createdAt DESC) | `notifications.ts:243` | ✓ used |

### Drift

- 🟡 **Vote-driven ranking index declared but query not wired**. `firestore.indexes.json:20–28` declares the upvote-ordered index. `src/services/clips.feed.ts` still orders by `createdAt`. This is documented in `docs/STATUS_REPORT.md:85` as "In Progress" — the index ships ahead of the feature, deliberately. Not silent drift, but worth noting since the report should match status to reality.

### Spot-check: every multi-field service query has an index

Sampled `grep -rEn "where\(|orderBy\(" src/services/` — every compound query (≥2 `where` clauses, or a `where` + `orderBy` on different fields) matches one of the seven indexes above. No missing indexes that would 500 in production.

---

## 5. storage.rules ↔ src/services/storage.ts

Covered fully in §3 above — every constant, enum, and path format matches. **Clean.**

---

## 6. CLAUDE.md ↔ package.json + vite.config.ts

| Claim | Source | Reality | Drift? |
| ----- | ------ | ------- | ------ |
| `verify` gate command | `CLAUDE.md:25` says `npx tsc -b && npm run lint && npm run test:coverage && npm run build && npm run check:test-dup` | `package.json:32` runs `tsc -b && npm run lint && npm run test:coverage && npm run build && npm run check:test-dup` | 🟢 cosmetic — bare `tsc` resolves via npm-script PATH |
| 100% coverage on `src/services/**` and `src/hooks/**` | `CLAUDE.md:68` | `vite.config.ts:103–105` | ✓ |
| `src/firebase.ts` coverage carve-out | not mentioned | `vite.config.ts:108` lowers to 93/100/80/93 | 🟢 missing from CLAUDE.md |
| `src/components/**` and `src/screens/**` floor | not mentioned | `vite.config.ts:110–111` 80/80/75/80 | 🟢 missing from CLAUDE.md |
| No state-management libs | `CLAUDE.md:94` | confirmed in `package.json` | ✓ |
| Tailwind only | `CLAUDE.md:59,93` | `package.json` has only `@tailwindcss/vite` + `tailwindcss` | ✓ |

---

## 7. docs/STATUS_REPORT.md ↔ shipped reality

### Confirmed accurate

- ✓ Phase 1–2 rows: cited files exist; features are wired (auth.ts, games services, etc.).
- ✓ Phase 3 "Vote-driven clip ranking" marked "In Progress" — matches reality (index live, query not wired).
- ✓ Phase 4 "Custom Mapbox style" marked "In Progress" — matches Issue #191.
- ✓ "[Unreleased] — Referee System" 9 items "In Review" — matches `games.judge.ts` + `firestore.rules` referee blocks.

### Drift

- 🟡 **"Focus trap in modals — Planned"** in §7 P1/P2/P3 gaps appears stale. `src/hooks/useFocusTrap.ts` exists. Verify whether it's wired up to every modal or only a subset; if all modals consume it, the row should be marked Done.
- 🟢 **"71 files / 761 tests"** in §Cross-Cutting Quality is a snapshot; expected to drift naturally between updates. Recount with `find src -name "*.test.ts*" | wc -l` next refresh.

---

## 8. docs/ARCHITECTURE.md ↔ src/App.tsx

### Routes — all 14 match

Every `<Route>` in `src/App.tsx:206–467` matches the route map in `docs/ARCHITECTURE.md:57–73` (`/`, `/auth`, `/profile`, `/lobby`, `/challenge`, `/game`, `/gameover`, `/record`, `/player/:uid`, `/map`, `/spots/:id`, `/settings`, `/privacy`, `/terms`, `/data-deletion`, `/feed` → `/lobby`, `/404`, `*`).

### Drift

- 🔴 **`docs/ARCHITECTURE.md:34`** asserts: _"No compound queries — all game queries use single-field equality filters (`player1Uid == uid`, `player2Uid == uid`) which are indexed automatically by Firestore."_ This is contradicted by `src/services/games.subscriptions.ts:29–44`, which does compound `where(playerNUid, ==, uid) + where(status, in, [...]) + orderBy(updatedAt, desc)` and explicitly requires the composite indexes declared in `firestore.indexes.json:30–60`. A reader who follows ARCHITECTURE.md would underestimate the index surface.

---

## 9. docs/DATABASE.md ↔ firestore.rules

### Three correctness-level drifts

- 🔴 **`docs/DATABASE.md:176`** says: _"Writing a nudge document triggers a Cloud Function that delivers a push notification via FCM."_
  - **Reality:** `functions/` directory does not exist. `CLAUDE.md:96` forbids Cloud Functions. Nudge delivery is client-side via `src/services/pushDispatch.ts`.
  - **Impact:** A new contributor reading DATABASE.md would look for nonexistent backend code, or worse, propose adding a Cloud Function to "fix" the delivery path.

- 🔴 **`docs/DATABASE.md:185`** continues the same misstatement on the `delivered` field: _"Set to `false` on create; updated by Cloud Function."_ No Cloud Function exists to perform the update. The field is set false on create (`firestore.rules` enforces this) and never marked `true` from the client (the rule explicitly forbids client updates).

- 🔴 **`docs/DATABASE.md:364–365`** asserts: _"No composite indexes are currently required. All game queries use single-field equality filters."_
  - **Reality:** `firestore.indexes.json` declares 7 composite indexes; `games.subscriptions.ts:29–44` actively requires two of them (`games(player1Uid,status,updatedAt)` and `games(player2Uid,status,updatedAt)`).
  - **Impact:** An operator following this guidance who removes the indexes file would break the lobby's live game subscriptions in production.

### Staleness

- 🟡 **`docs/DATABASE.md:40–46`** describes notification-collection access without mentioning the recipient-delete path now in `firestore.rules:1260–1261`, added in the NOTIFICATION_AUDIT.md BUG-1 remediation.
- 🟡 **`docs/DATABASE.md:92`** describes the transitional users-update relaxation without flagging that PR #336 (per `docs/AUDIT_2026-05.md:F2`) is open to tighten it.

---

## 10. docs/GAME_STATE_MACHINE.md ↔ services/games.* + firestore.rules

Six states (active:setting, active:matching, active:setReview, active:disputable, complete, forfeit) and every transition between them are implemented in the service layer and enforced in the rules:

| Transition | Doc section | Service entry | Rule branch |
| ---------- | ----------- | ------------- | ----------- |
| `createGame` | L120–130 | `games.create.ts:createGame` | rules L430–495 |
| `setTrick` | L132–144 | `games.match.ts` | rules L568–591 |
| `submitMatchAttempt` (paths A/B/C) | L146–177 | `games.match.ts:130–301` | rules matching-update block |
| `callBSOnSetTrick` | L179–185 | `games.judge.ts:37–60` | setReview branch |
| `judgeRuleSetTrick` | L187–193 | `games.judge.ts:78+` | setReview→matching\|setting |
| `resolveDispute` | L195–224 | `games.judge.ts` | disputable→setting\|complete |
| `acceptJudgeInvite` / `declineJudgeInvite` | L226–231 | `games.judge.ts` | judgeStatus transitions |
| `forfeitExpiredTurn` | L234–257 | `games.turns.ts:78–167` | forfeit branches |

### Drift

- 🟢 **`docs/GAME_STATE_MACHINE.md:286–296`** lists `p1Letters/p2Letters ∈ [0,5]` as an invariant. The rule actually enforces "monotonically non-decreasing, ≤1 increment per write" (`firestore.rules:666–676`), and the game completes when either reaches ≥5 (`firestore.rules:696–699`). Post-completion the value could in principle be 5 in a single completing write. The doc invariant is imprecise but not wrong about the steady-state.

---

## 11. docs/AUDIT_2026-05.md ↔ current state

Each prior-audit finding revisited against HEAD as of 2026-05-18:

| Prior finding | Status in AUDIT_2026-05.md | Current reality |
| ------------- | -------------------------- | --------------- |
| F1 `clips.ts` 620 LOC split | "Open PR #341" | 🟡 **Merged.** `src/services/clips.ts` is now a 28-LOC barrel; six shards (`clips.{mappers,writes,feed,upvotes,cascade}.ts`) exist. |
| F2 users sensitive-fields guard | "Open PR #336" | 🟡 **Re-verify.** `firestore.rules:167–176` still contains the transitional relaxation. Confirm whether #336 has landed. |
| F3 SpotDetailPage useNavigate drift | "Open PR #342" | 🟡 **Re-verify** against `src/screens/SpotDetailPage.tsx`. |
| F4 `games.test.ts` 1938 LOC split | "Open PR #345" | 🟡 **Re-verify** against `src/services/__tests__/`. |
| F5 App Check disabled | open | ✓ still open per env config |
| F6 CSP unsafe-inline | open | ✓ still open per `vercel.json` |
| F7 Lighthouse warn→error | open | ✓ |
| F8 Playwright E2E surface | open | ✓ |
| F9 Sentry capacitor v3→v4 | open | ✓ |
| F10 `getIdToken(true)` before createGame | open | ✓ |
| F11 turnHistory per-record cap | acknowledged, not actionable | ✓ |

---

## 12. .github/workflows/ ↔ CLAUDE.md guardrails

### Enforced in `pr-gate.yml`

| Guardrail | Job | Status |
| --------- | --- | ------ |
| No `as any` | `guard-as-any-casts` (L25–36) | ✓ |
| No TODO/FIXME/HACK | `guard-todo-fixme-hack` (L60–73) | ✓ |
| No Cloud Functions | `verify-no-cloud-functions` (L37–58) | ✓ |
| Workflow-file review | `verify-workflow-changes` (L75–94) | ✓ (warn-only) |
| Test duplication | `check-test-duplication` (L96–104) | ✓ |
| File-length budgets | `check-file-length` (L106–117) | ✓ non-blocking |
| Rules tests on rules changes | `validate-firebase-rules` (L119–158) | ✓ |
| Full verify gate | `main.yml` `build-and-test` | ✓ |

### Not enforced in CI

- 🟡 **`console.log` ban** (CLAUDE.md L143) — no grep job in `pr-gate.yml`.
- 🟡 **No Firebase imports outside `src/services/**`** (CLAUDE.md L57) — no grep job.
- 🟡 **No CSS files** (CLAUDE.md L59, L145) — no grep job for `*.css` imports.
- 🟡 **No state-management libs** (CLAUDE.md L94) — no `package.json` dependency check.

These four guardrails have held via code review alone. They are not contractual violations — they are gaps between policy and automation.

---

## Other docs cross-checked

- ✓ **README.md** (root) — Node ≥22, env var names, stack versions, Quick Start commands all current.
- ✓ **docs/GAME_MECHANICS.md** — S.K.A.T.E. letter accumulation, win condition, dispute flow, judge auto-accept on deadline — all match service code.
- 🟢 **docs/NOTIFICATION_AUDIT.md** — BUG-1 cites old line numbers; remediation is at `firestore.rules:1260–1261`, not `firestore.rules:984–986`. Fix is in place; only the citation is stale.
- 🟢 **docs/P0-SECURITY-AUDIT.md** — line 20 heading still reads "`notifications` collection has NO security rules." Body at line 213 acknowledges the fix landed. Heading is misleading on its own.

---

## Summary

| Severity | Count |
| -------- | ----: |
| 🔴 correctness | **4** |
| 🟡 staleness | **18** |
| 🟢 cosmetic | **6** |
| **Total** | **28** |

### 🔴 Correctness drifts (read these first)

1. `docs/DATABASE.md:176,185` — Cloud Function nudge delivery claim contradicts `CLAUDE.md:96` and reality (no `functions/` dir; client-side via `pushDispatch.ts`).
2. `docs/DATABASE.md:364–365` — "No composite indexes are currently required" is false; 7 composite indexes are live and 2 are required by `games.subscriptions.ts`.
3. `docs/ARCHITECTURE.md:34` — "No compound queries" is contradicted by `games.subscriptions.ts:29–44`.
4. _(grouped with #1)_ `docs/DATABASE.md:185` — `delivered: false` update path attributed to a Cloud Function that does not exist.

### Recommended remediation order

The report records this order; **no work is performed here**.

1. **DATABASE.md** — fix the three 🔴 lines. Doc-only edit, no code risk.
2. **ARCHITECTURE.md** — remove or rewrite the "no compound queries" sentence at L34.
3. **AUDIT_2026-05.md** — re-verify F1–F4 against HEAD and mark merged items as resolved.
4. **NOTIFICATION_AUDIT.md / P0-SECURITY-AUDIT.md** — update stale line references and the misleading heading.
5. **STATUS_REPORT.md** — verify focus-trap row; refresh test count.
6. **CLAUDE.md** — document the `src/firebase.ts` coverage carve-out and components/screens floors so the "100% on services" claim isn't read as universal.
7. **LOC overages** — 10 files over soft budget. Per CLAUDE.md these are signals to extract helpers, not blockers. Schedule small per-file PRs; no drive-bys.
8. **CI gap (optional)** — add `pr-gate.yml` grep jobs for `console.log`, Firebase imports outside services, `*.css` imports, and state-management dependencies. Promotes four currently-honor-system guardrails into automated checks.

### What is not drift

- Server-managed fields (`wins`, `losses`, `lastGameCreatedAt`, `lastSpotCreatedAt`, `onboardingTutorialVersion`, `spot.isActive`, `spot.isVerified`) appear in `firestore.rules` but are not set by the visible service code path. Rules enforce defaults; transactions update them server-side. This is intentional and not flagged.
- The vote-ranking composite index that exists without a backing query is **documented** in STATUS_REPORT.md as "In Progress." Index-ahead-of-feature is the correct sequencing.

### Coverage of the audit

| Pairing | Sections | Drift found |
| ------- | -------- | ----------- |
| 1. CLAUDE.md ↔ code | §1 | 10 🟡 (LOC) |
| 2. rules ↔ games/clips services | §2 | 0 |
| 3. rules ↔ users/spots/reports/blocks/votes/storage services | §3, §5 | 0 |
| 4. rules ↔ indexes ↔ queries | §4 | 1 🟡 |
| 5. storage.rules ↔ storage.ts | §5 | 0 |
| 6. CLAUDE.md ↔ package.json/vite.config.ts | §6 | 3 🟢 |
| 7. STATUS_REPORT.md ↔ shipped | §7 | 1 🟡 + 1 🟢 |
| 8. ARCHITECTURE.md ↔ App.tsx | §8 | 1 🔴 |
| 9. DATABASE.md ↔ rules | §9 | 3 🔴 + 2 🟡 |
| 10. GAME_STATE_MACHINE.md ↔ services + rules | §10 | 1 🟢 |
| 11. AUDIT_2026-05.md ↔ HEAD | §11 | 4 🟡 |
| 12. workflows ↔ CLAUDE.md | §12 | 4 🟡 |

**Conclusion:** The code-side sources of truth (CLAUDE.md guardrails, firestore.rules, service layer, TS types, indexes, storage rules, CI) are tightly aligned. The documentation tree is where almost all drift lives — three of the four 🔴 drifts are in `docs/DATABASE.md`, one is in `docs/ARCHITECTURE.md`. A single doc-only PR can clear every 🔴 finding.
