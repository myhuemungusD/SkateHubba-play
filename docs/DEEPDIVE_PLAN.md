# Deepdive Continuation Plan

Continuation of the "Launch deepdive agents for code and docs analysis" session that crashed on a stream-idle timeout before the plan file could be written. Re-ran the three audits on current `main` (+129 commits past the crash point). This file aggregates findings and partitions them into file-disjoint fix batches.

- Branch: `claude/deepdive-continue`
- Base: `main` at `596c087`
- Findings total: **2 critical · 20 high · 33 medium · 35 low = 90**
- Scope: services/hooks, UI/routing, docs. Code in `functions/`, `e2e/`, `rules-tests/`, `scripts/`, `infra/` were cross-referenced but not audited.

## Findings by scope

| Scope | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Services & hooks | 0 | 3 | 11 | 20 | 34 |
| UI & routing | 1 | 7 | 9 | 4 | 21 |
| Docs | 1 | 10 | 13 | 11 | 35 |

Previously-reported findings re-verified on current main:
- Honor-system landed notification copy — **still present** (Batch 1).
- Stale closure race in `subscribeToMyGames` — **fixed** on main; residual render-order flicker noted as medium (deferred).
- Unpinned fields in firestore.rules transitions — **fixed**.
- Partial-deletion orphaning in account delete — **partially fixed**; still missing `blocked_users`, `clipVotes`, `notifications` (Batch 2).

## Fix batches

All batches are file-disjoint. They can ship independently (separate commits, separate PRs if desired).

### Batch 4 — NotificationBell a11y (CRITICAL)
Outer `<button>` wraps an inner delete `<button>` — invalid HTML, WCAG 2.1 SC 4.1.2 fail.

- `src/components/NotificationBell.tsx` — convert outer to `div[role="button"]` using the `cardButtonProps` pattern already proven in `src/screens/Lobby.tsx`.
- `src/components/__tests__/NotificationBell.test.tsx` — new file; assert keyboard parity and non-nested semantics.

### Batch 1 — Honor-system landed notification copy (HIGH)
`src/services/games.ts:702-711` sends a "Your Turn!" CTA push to the OLD setter every time the matcher lands honor-system. Recipient opens the app and sees "opponent is setting…" with no action. Hits every honor-system-landed turn.

- `src/services/games.ts` — fix recipientUid, notification type, and body.
- `src/services/__tests__/games.test.ts` — assert notification payload in honor-system-landed branch (previously uncovered).

### Batch 2 — Account-deletion cascade completeness (HIGH)
`src/services/users.ts` `deleteUserData` leaks `blocked_users`, `clipVotes`, and received `notifications` after account deletion. `deleteUserNotifications` already exists in `notifications.ts` but is never wired in. GDPR / CCPA right-to-erasure violation.

- `src/services/users.ts` — extend `deleteUserData` before the auth-delete step.
- `src/services/notifications.ts` — confirm / tighten `deleteUserNotifications` if needed.
- `src/services/blocking.ts` — add a batched `deleteUserBlockedList(uid)` helper.
- `src/services/clipVotes.ts` (or in-line in users.ts) — query+batch-delete the user's clipVotes.
- `src/services/__tests__/users.test.ts` — add cascade coverage.

### Batch 3 — Nudge rate-limit server-side enforcement (HIGH)
`/nudges` create rule has **no** rate-limit dependency. Client-side cooldown in `sendNudge` is bypassable. Notification-spam vector via the yet-to-return FCM sender.

- `firestore.rules` — `/nudges` create rule requires `exists()` of a fresh `/nudge_limits/{uid}_{gameId}` written in the SAME batch; match the shape of `/notifications` create.
- `src/services/nudge.ts` — flip write order: `nudge_limits` first, then `addDoc(nudges, …)`. Tighten localStorage set timing.
- `rules-tests/nudges-rate-limit.rules.test.ts` — new red-team test suite.

### Batch 5 — Settings router-based legal links (HIGH)
`src/screens/Settings.tsx:455, 461, 467` use `<a href="/privacy">`, `<a href="/terms">`, `<a href="/data-deletion">` — each forces a full page reload, Sentry session reset, analytics session reset, lost scroll position.

- `src/screens/Settings.tsx` — replace the three anchors with `<Link to="/…">`; also sweep `bg-[#0A0A0A]/80` → `bg-background/80` (low-sev brand token).
- `src/screens/__tests__/Settings.test.tsx` — assert Link usage.

### Batch 6 — Map subtree migration off lucide-react + into brand tokens + router-based nav (HIGH cluster)
The entire `src/components/map/**` subtree plus `SpotDetailPage` + `MapPage` were built to a different style contract: third-party UI kit (`lucide-react`), Tailwind default orange (`#F97316`) instead of brand orange (`#FF6B00`), imperative `useNavigate()` on user-clicks, `<style>` tag injection at runtime, inline `style` for `h-100dvh`, `document.createElement` marker mutations. Biggest and most invasive batch.

- `src/components/icons.tsx` — add ~14 new glyphs (`Crosshair`, `MapPinOff`, `Plus`, `X`, `Search`, `SlidersHorizontal`, `BadgeCheck`, `Navigation`, `ImageOff`, `Flag`, `Flame`, `ShieldAlert`, `MapPin`, `Send`).
- `src/components/map/SpotMap.tsx`
- `src/components/map/SpotPreviewCard.tsx`
- `src/components/map/SpotFilterBar.tsx`
- `src/components/map/AddSpotSheet.tsx`
- `src/components/map/BustRisk.tsx`
- `src/components/map/GnarRating.tsx`
- `src/screens/SpotDetailPage.tsx`
- `src/screens/MapPage.tsx`
- `src/index.css` — move `.spot-pulse-ring` / `.spot-user-dot` CSS in from runtime injection; reference `var(--color-brand-orange)`.
- `package.json` — remove `lucide-react` if every usage is gone.
- Tests in `src/components/map/__tests__/**` — assert Link usage + brand token application.

### Batch 7a — Code-reference docs alignment (HIGH cluster)
Four docs still reference the pre-judge-feature names `submitMatchResult` / `submitConfirmation` / `phase: "confirming"`. ARCHITECTURE.md still says "no React Router, no URL-based routing" and "React 18". STATUS_REPORT points at `src/screens/AgeGate.tsx` which doesn't exist.

- `docs/API.md` — `submitMatchResult` → `submitMatchAttempt`, fix arg order and return shape.
- `docs/ARCHITECTURE.md` — rewrite routing section to reflect react-router-dom v7 + `NavigationContext`; flip React 18 → 19; sync route table with `src/App.tsx:202-464`; document the `skatehubba:open-game` deep-link listener.
- `docs/GAME_MECHANICS.md` — `submitMatchResult` → `submitMatchAttempt`; add `failSetTrick` path.
- `docs/FIRESTORE_SECURITY_AUDIT.md` — `submitConfirmation` → actual turnHistory writers.
- `docs/DATABASE.md` — drop `phase: "confirming"`; add `setReview`, `disputable`, `judgeId`, `judgeStatus`, `judgeReviewFor`, `turnHistory`; add missing collections (`notification_limits`, `reports`, `clips`, `clipVotes`, `spots`); note three-doc atomicity of `createProfile`.
- `docs/STATUS_REPORT.md` — replace `src/screens/AgeGate.tsx` evidence with `AuthScreen.tsx` / `ProfileSetup.tsx` / `NavigationContext.tsx`; regenerate line numbers on the skatehubba:open-game and Rematch rows.
- `docs/P0-SECURITY-AUDIT.md` — flip `notifications` row from FAIL → PASS.
- `docs/COMPREHENSIVE_GAP_ANALYSIS.md` — mark T1 (E2E) / T2 (rules tests) as Closed; mark TEST-2 as N/A (functions/ removed).

### Batch 7b — Onboarding + ops docs refresh (HIGH / MED)
`docs/DEVELOPMENT.md` is the most stale doc. `CONTRIBUTING.md` says "we don't use a linter" despite ESLint + Prettier + Husky. `.env.example` is missing env vars that `src/lib/env.ts` parses. `CLAUDE.md` guardrail row for `functions/` still reads as "gate" rather than "removed".

- `CLAUDE.md` — align `functions/` guardrail with the skill file ("package removed; re-introduction requires maintainer approval"); rewrite Golden Rules 6-7 with proper capitalization + rationale; soften "Don't modify `.github/workflows/`" to "maintainer sign-off required".
- `.skills/skatehubba-chief-engineer/SKILL.md` — minor consistency nits.
- `README.md` — add `typecheck` and `verify` to Scripts table.
- `CONTRIBUTING.md` — fix "no linter config" claim; loosen `.env.example` PR checklist wording OR enforce it by adding the missing vars.
- `.env.example` — add commented-out `VITE_APPCHECK_ENABLED`, `VITE_APP_VERSION`, `VITE_GIT_SHA` (match `src/lib/env.ts:55-59`).
- `docs/DEVELOPMENT.md` — regenerate Project Structure tree from `ls src/services/` + `ls src/hooks/`; remove `tailwind.config.js` reference (Tailwind v4 `@theme` in `src/index.css`); replace single `smoke-e2e.test.tsx` with per-area smoke tests; add `VITE_MAPBOX_TOKEN` + optional vars; point to README's Scripts table instead of a truncated re-copy.
- `docs/DEPLOYMENT.md` — fix "45+ tests" figure → `npm run test:coverage` gate; add missing env vars (`VITE_APPCHECK_ENABLED`, `VITE_RECAPTCHA_SITE_KEY`, `VITE_SENTRY_DSN`, `VITE_FIREBASE_VAPID_KEY`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_FIREBASE_MEASUREMENT_ID`).
- `docs/PERMISSION_DENIED_RUNBOOK.md` — `firebase-tools@14` → `@latest`; replace "play project" with "SkateHubba Vercel project".

## Deferred items (not shipping now)

These are tracked by the agents' reports but are low-ROI for the current sweep. Pull out into separate follow-ups if they come up organically.

- Agent 1 medium: `writeNotification` best-effort race, `isJudgeActive` type-guard signature, `subscribeToMyGames` first-render partial emit, `updatePlayerStats` client-trust (needs a rules-level change, too big for this batch set), `deleteUserClips` retry policy, `useAuth` `Object.assign` fragility, `writeLandedClipsInTransaction` retry-safety docs, `getLeaderboard` excludes no-wins users, `createGame` `lastGameCreatedAt` setDoc.
- Agent 1 low: 20 items — all test gaps / consistency nits / dead-export cleanup. Batch these into a future "dead-code + test-gap sweep" PR.
- Agent 2 medium: `Toast`, `UploadProgress`, `PullToRefreshIndicator`, `Leaderboard` inline styles on continuous animation values (flagged but inherently dynamic; accept OR document an explicit CLAUDE.md exception).
- Agent 2 medium: `InviteButton` `rgba(255,107,0,X)` → `brand-orange/X`; `Landing.tsx` gradient literals → brand tokens; `BottomNav` "Me" tab active for other users' `/player/:uid`.
- Agent 3 low: 11 items — line-number drift, project-name nits, "45+ tests" figure. Fold into Batch 7b where naturally relevant; otherwise defer.

## Ship order

1. **Batch 4** (CRITICAL, smallest)
2. **Batch 1** (HIGH, user-visible every honor-system turn)
3. **Batch 2** (HIGH, GDPR)
4. **Batch 3** (HIGH, security / rules + service)
5. **Batch 5** (HIGH, small & contained)
6. **Batch 6** (HIGH cluster, biggest code change)
7. **Batch 7a** (docs, no code risk)
8. **Batch 7b** (docs + `.env.example`, no code risk)

Pause for review after every batch.
