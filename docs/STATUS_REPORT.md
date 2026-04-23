# Feature Completion Status Report

**Generated:** 2026-04-16
**Source of truth:** `src/`, `firestore.rules`, `e2e/`, `rules-tests/`, `CHANGELOG.md`, `docs/COMPREHENSIVE_GAP_ANALYSIS.md`

Status legend:

- **Done** — shipped to `main`, in production, covered by tests
- **In Review** — code on a branch / `[Unreleased]` in CHANGELOG, not yet released
- **In Progress** — partial implementation in repo (code, types, or rules present but feature not user-facing)
- **Deferred** — explicitly de-prioritized; pulled off the active roadmap pending a future revisit
- **Planned** — on the roadmap, no code yet
- **Ops Pending** — code is ready; deployment / infra task remains

---

## 1. Phase 1 — Core Loop (Released v1.0.0)

| Feature                        | Status   | Evidence                                                                                                                        |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Email/password sign-up         | **Done** | `src/services/auth.ts`, `e2e/auth.spec.ts`                                                                                      |
| Email/password sign-in         | **Done** | `src/services/auth.ts`                                                                                                          |
| Email verification + resend    | **Done** | `src/services/auth.ts`, `src/components/VerifyEmailBanner.tsx`                                                                  |
| Google OAuth (popup+redirect)  | **Done** | `src/services/auth.ts`, `src/services/__tests__/auth-google.test.ts`                                                            |
| Password reset                 | **Done** | `src/services/auth.ts`                                                                                                          |
| Atomic username reservation    | **Done** | `src/services/users.ts` (uses `runTransaction`)                                                                                 |
| Profile setup (stance, name)   | **Done** | `src/screens/ProfileSetup.tsx`                                                                                                  |
| Challenge by username          | **Done** | `src/screens/ChallengeScreen.tsx`                                                                                               |
| Setting phase (record + name)  | **Done** | `src/screens/GamePlayScreen.tsx`, `src/components/VideoRecorder.tsx`                                                            |
| Matching phase (watch+attempt) | **Done** | `src/screens/GamePlayScreen.tsx`                                                                                                |
| Self-judging (landed/missed)   | **Done** | `src/services/games.ts`                                                                                                         |
| S.K.A.T.E. letter accumulation | **Done** | `src/components/LetterDisplay.tsx`, rules in `firestore.rules`                                                                  |
| Win condition (5 letters)      | **Done** | `src/screens/GameOverScreen.tsx`, `firestore.rules`                                                                             |
| Real-time game updates         | **Done** | `src/services/games.ts` (dual `onSnapshot` for OR query)                                                                        |
| 24-hour turn timer             | **Done** | `src/components/Timer.tsx`, `src/components/LobbyTimer.tsx`                                                                     |
| Auto-forfeit on expiry         | **Done** | `src/services/games.ts`                                                                                                         |
| WebM video recording (web)     | **Done** | `src/components/VideoRecorder.tsx`                                                                                              |
| MP4 capture (native)           | **Done** | `src/services/nativeVideo.ts`                                                                                                   |
| Video upload + size guard      | **Done** | `src/services/storage.ts` (1 KB – 50 MB, retry w/ backoff)                                                                      |
| Lobby (active+completed games) | **Done** | `src/screens/Lobby.tsx`                                                                                                         |
| Player profile + game history  | **Done** | `src/screens/PlayerProfileScreen.tsx`                                                                                           |
| Privacy Policy / ToS / Data    | **Done** | `src/screens/PrivacyPolicy.tsx`, `TermsOfService.tsx`, `DataDeletion.tsx`                                                       |
| Account deletion               | **Done** | `src/services/auth.ts`, `src/components/DeleteAccountModal.tsx`                                                                 |
| Age gate (COPPA, 13+)          | **Done** | Inline DOB + parental-consent on `src/screens/AuthScreen.tsx`; carried to ProfileSetup via `NavigationContext.setAgeGateResult` |
| Consent banner                 | **Done** | `src/components/ConsentBanner.tsx`                                                                                              |
| Offline read support           | **Done** | `src/firebase.ts` (persistent cache), `src/components/OfflineBanner.tsx`                                                        |
| PWA install                    | **Done** | `index.html`, `public/manifest`                                                                                                 |
| Capacitor iOS/Android shells   | **Done** | `capacitor.config.ts`, `android/`, `ios/` (per `cap:open:*` scripts)                                                            |
| Sentry error tracking          | **Done** | `src/lib/sentry`, `src/main.tsx`                                                                                                |
| Vercel Analytics + Speed       | **Done** | `src/App.tsx` (`Analytics`, `SpeedInsights`)                                                                                    |
| Firestore security rules       | **Done** | `firestore.rules` (~66 KB, validates turn order + scores + rate limits + judge paths)                                           |
| Storage security rules         | **Done** | `storage.rules`                                                                                                                 |

**Phase 1 verdict:** 100% complete, in production at [skatehubba.com](https://skatehubba.com).

---

## 2. Phase 2 — Viral Mechanics

| Feature                          | Status   | Evidence                                                                                                                |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Invite flow (SMS / link / share) | **Done** | `src/components/InviteButton.tsx` + `invite_sent` analytics                                                             |
| Rematch from Game Over           | **Done** | `src/screens/GameOverScreen.tsx`; rematch handler wired on the `/gameover` route in `src/App.tsx`                       |
| Push notification registration   | **Done** | `src/services/fcm.ts`, `src/components/PushPermissionBanner.tsx`                                                        |
| In-app notification bell         | **Done** | `src/components/NotificationBell.tsx`, `src/services/notifications.ts`                                                  |
| Game notification watcher        | **Done** | `src/components/GameNotificationWatcher.tsx`                                                                            |
| Deep-link from push → game       | **Done** | `src/App.tsx` — `useEffect` registers the `skatehubba:open-game` window listener and routes to the matching active game |
| Clip sharing (social platforms)  | **Done** | `src/components/ClipsFeed.tsx`, `src/services/clips.ts` + `clip_shared`                                                 |
| Clip save (local download)       | **Done** | `clip_saved` analytic, `ClipsFeed.tsx`                                                                                  |
| Game share (post-game)           | **Done** | `game_shared` analytic                                                                                                  |

**Phase 2 verdict:** All listed Phase 2 mechanics are shipped; README roadmap matches.

---

## 3. Phase 3 — Social Graph & Discovery

| Feature                        | Status          | Evidence                                                                                                                                                                                                                                                                           |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public player profiles         | **Done**        | `src/screens/PlayerProfileScreen.tsx`, route `/player/:uid`                                                                                                                                                                                                                        |
| Search / challenge by username | **Done**        | `src/screens/ChallengeScreen.tsx` (uses `getUidByUsername`)                                                                                                                                                                                                                        |
| Leaderboard                    | **Done**        | `src/components/Leaderboard.tsx` + tests                                                                                                                                                                                                                                           |
| Cross-game clips feed          | **Done**        | `src/components/ClipsFeed.tsx` (incl. autoplaying top-slot rotation), `src/services/clips.ts`                                                                                                                                                                                      |
| Clip upvote primitives         | **Done**        | `upvoteClip()`, `clipVotes` collection, `/clipVotes/{voteId}` match block in `firestore.rules`, `AlreadyUpvotedError`, UI in `ClipsFeed`                                                                                                                                           |
| Vote-driven clip ranking       | **In Progress** | ⚠️ The clips feed is currently ordered by `createdAt desc` with a `__name__` tiebreaker — see `fetchClipsFeed()` in `src/services/clips.ts`. Upvote counts are surfaced in the UI (via `fetchClipUpvoteState`) but don't drive ordering anywhere yet — that's the active work item |
| Block / report users           | **Done**        | `src/services/blocking.ts`, `src/services/reports.ts`, `ReportModal`                                                                                                                                                                                                               |
| Spectator mode (watch live)    | **Deferred**    | Pushed back per product call (2026-04-15) — revisit after vote-driven ranking ships                                                                                                                                                                                                |
| Pro username badge             | **Done**        | `src/components/ProUsername.tsx`                                                                                                                                                                                                                                                   |

**Phase 3 verdict:** 7 / 8 ≈ **88% complete on the post-defer scope** (excludes the deferred spectator item), or 7 / 9 ≈ **78% of the full roadmap slate** including it. The Roadmap Completion Summary in §8 uses the full-slate denominator; this one uses the active-scope denominator — pick whichever matches the conversation. Vote-driven ranking is the active focus; spectator is parked.

---

## 4. Phase 4 — Network Effects

| Feature                         | Status          | Evidence                                                                                                                                                |
| ------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spot tagging (geo-tagged map)   | **Done**        | `src/screens/MapPage.tsx`, `SpotDetailPage.tsx`, `src/components/map/*`, `src/services/spots.ts`, `e2e/map.spec.ts`, `rules-tests/spots.rules.test.ts`  |
| Spot ↔ game linkage             | **Done**        | `SpotDetailPage.tsx` challenge button navigates to `/challenge?spot=`, `SpotPreviewCard.tsx` mirrors the flow, `rules-tests/games-spotId.rules.test.ts` |
| Add a Spot UX                   | **Done**        | `src/components/map/AddSpotSheet.tsx`                                                                                                                   |
| Spot filters (gnar / bust risk) | **Done**        | `src/components/map/SpotFilterBar.tsx`, `BustRisk.tsx`, `GnarRating.tsx`                                                                                |
| Bottom tab bar (Home/Map/Me)    | **Done**        | `src/components/BottomNav.tsx`, persistent navigation across main screens                                                                               |
| Custom Mapbox style             | **In Progress** | Issue [#191](https://github.com/myhuemungusD/SkateHubba-play/issues/191) — design + infra task, no code change needed                                   |
| Crew challenges (3v3)           | **Planned**     | No code yet                                                                                                                                             |
| Trick library                   | **Planned**     | No code yet                                                                                                                                             |
| Tournaments                     | **Planned**     | No code yet                                                                                                                                             |

**Phase 4 verdict:** Spots/Map sub-feature is shipped (map UI, CRUD, filters, spot↔game linkage, tab bar). Custom Mapbox style is a design/infra task in progress. Crew, library, and tournaments remain on the roadmap.

---

## 5. Unreleased — Referee System (`[Unreleased]` in CHANGELOG)

> **Naming note:** User-facing copy says **referee** (commit `91b90f1`), but the
> data model keeps the original `judge*` field names to avoid a Firestore
> migration for in-flight games. Rows that reference product behavior use
> "referee"; rows that reference schema fields keep the literal `judge*` names.

| Feature                               | Status        | Evidence                                                    |
| ------------------------------------- | ------------- | ----------------------------------------------------------- |
| Optional referee nomination at create | **In Review** | `src/screens/ChallengeScreen.tsx`, CHANGELOG `[Unreleased]` |
| Referee accept / decline notification | **In Review** | `src/services/notifications.ts`                             |
| Dispute → referee ruling (24 h)       | **In Review** | `src/services/games.ts`, `firestore.rules`                  |
| "Call BS" on setter (24 h)            | **In Review** | `src/services/games.ts`                                     |
| Referee-only `setReview` phase        | **In Review** | New `GamePhase` value                                       |
| Honor system path (no referee)        | **In Review** | CHANGELOG `Changed` section                                 |
| `judgeId` / `judgeStatus` schema      | **In Review** | `GameDoc` extension (internal names preserved)              |
| `TurnRecord.judgedBy`                 | **In Review** | Schema change (internal name preserved)                     |
| Rules: referee immutability + scoping | **In Review** | `firestore.rules` updates                                   |

**Verdict:** Code complete, awaiting next release tag. Honor-system path replaces the old `disputable` mid-turn pause for non-refereed games.

---

## 6. Cross-Cutting Quality

| Concern                         | Status   | Notes                                                                                                           |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| TypeScript strict, no `any`     | **Done** | `tsc -b` green, lint enforced                                                                                   |
| Unit + component tests          | **Done** | 71 files / 761 tests (per latest gap analysis)                                                                  |
| 100% coverage on services/hooks | **Done** | Enforced by Vitest thresholds                                                                                   |
| Firestore rules unit tests      | **Done** | `rules-tests/clips.rules.test.ts`, `spots.rules.test.ts`, `games-spotId`, `notifications` (closes prior gap T2) |
| E2E (Playwright)                | **Done** | `e2e/auth.spec.ts`, `e2e/game.spec.ts`, `e2e/map.spec.ts` (closes prior gap T1)                                 |
| Lighthouse CI                   | **Done** | `.lighthouserc.json` in repo root                                                                               |
| GitHub Actions CI gate          | **Done** | `.github/workflows/`                                                                                            |
| Conventional commits            | **Done** | Husky + lint-staged + commitlint setup                                                                          |
| Sentry + PII scrubbing          | **Done** | `src/lib/sentry`, `docs/SENTRY_ALERTS.md`                                                                       |
| App Check (reCAPTCHA v3)        | **Done** | `src/firebase.ts` (silent fallback if env missing — gap S1)                                                     |
| Dark theme + custom tokens      | **Done** | `src/index.css` (Tailwind v4 `@theme`)                                                                          |

---

## 7. Outstanding Gaps (from `docs/COMPREHENSIVE_GAP_ANALYSIS.md`)

### P1 — Infrastructure / Ops (not code-blocked)

| Item                                  | Status          | Owner |
| ------------------------------------- | --------------- | ----- |
| Automate Firebase rules deploy in CI  | **Ops Pending** | Ops   |
| Daily Firestore managed exports       | **Ops Pending** | Ops   |
| Storage lifecycle rule for old videos | **Ops Pending** | Ops   |
| GitHub branch protection rules        | **Ops Pending** | Ops   |
| "Download My Data" (GDPR Art. 20)     | **Done**        | Dev   |

### P2 — Quality

| Item                                  | Status      |
| ------------------------------------- | ----------- |
| Focus trap in modals                  | **Planned** |
| Accessibility (axe-core) in CI        | **Planned** |
| TTL cleanup for username reservations | **Planned** |

### P3 — Polish

| Item                                               | Status      |
| -------------------------------------------------- | ----------- |
| Extract shared username validation constants       | **Planned** |
| JSDoc on exported service functions                | **Planned** |
| Inline rationale comments in `firestore.rules`     | **Planned** |
| Smoke tests for `RecordScreen` (now PlayerProfile) | **Planned** |
| Lazy-load Landing page imagery                     | **Planned** |

---

## 8. Roadmap Completion Summary

| Phase                              | Items | Done | In Review | In Progress | Deferred | Planned |     % Shipped |
| ---------------------------------- | ----: | ---: | --------: | ----------: | -------: | ------: | ------------: |
| Phase 1 — Core Loop                |    31 |   31 |         0 |           0 |        0 |       0 |      **100%** |
| Phase 2 — Viral Mechanics          |     9 |    9 |         0 |           0 |        0 |       0 |      **100%** |
| Phase 3 — Social Graph & Discovery |     9 |    7 |         0 |           1 |        1 |       0 |       **78%** |
| Phase 4 — Network Effects          |     9 |    5 |         0 |           1 |        0 |       3 |       **56%** |
| Unreleased — Referee System        |     9 |    0 |         9 |           0 |        0 |       0 | **In review** |

**Overall product completion (shipped + in-review, excluding deferred):** 61 of 66 non-deferred items ≈ **92%**. Including the single deferred item (spectator), 61 of 67 ≈ 91%.
**Active focus:** Vote-driven clip ranking (Phase 3), custom Mapbox style (Phase 4 — design/infra).
**Production gate:** Green (per gap analysis: 9.7/10, all P0 closed).

---

## 9. Recommended Next Actions

1. **Ship vote-driven clip ranking** _(active focus)_:
   - Replace the chronological order in `fetchClipsFeed()` (`src/services/clips.ts`) with an upvote-count-ranked query, falling back to recency when vote counts tie or are zero.
   - Add a "Top" / "New" toggle on `ClipsFeed` so the feed can sort by upvotes over a rolling window (24 h / 7 d / all-time).
   - Backfill an aggregate `upvoteCount` field on the clip doc (or denormalised counter doc) so feed sorting doesn't require N aggregate queries per page.
   - Instrument `clip_upvoted` analytics event to measure tap-through on the new ranking surface.
   - Add Firestore rules-test coverage for the new ranked query path (read-only, but worth pinning).
2. **Cut a release tag** for the Referee System so CHANGELOG `[Unreleased]` rolls into a `v1.x.0`.
3. **Custom Mapbox style** ([#191](https://github.com/myhuemungusD/SkateHubba-play/issues/191)) — design a branded dark-base style in Mapbox Studio and set `VITE_MAPBOX_STYLE_URL` in Vercel. No code change needed; `src/lib/mapbox.ts` already reads the env var.
4. ~~Spec spectator mode~~ — **deferred**; revisit after vote-driven ranking is in production and we can read the engagement numbers.
5. **Schedule the P1 ops items** (rules deploy, backups, video purge, branch protection) — these are blockers for scaling, not for shipping.
6. **Decide on Crew / Trick Library / Tournaments** sequencing — these are the biggest remaining bets and should be prioritised against learnings from the spots/map launch.
