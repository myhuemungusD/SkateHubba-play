# Comprehensive Gap Analysis — SkateHubba-Play

**Date:** 2026-04-15 (updated from 2026-03-24)
**Stack:** React 19 + TypeScript (strict) + Firebase (Auth / Firestore / Storage) + Vercel
**Verification gate:** `tsc -b` ✓ | `lint` ✓ | `761/761 tests` ✓ | `build` ✓

---

## Executive Summary

SkateHubba-Play is production-ready with strong fundamentals: zero TypeScript errors, 100% service/hook test coverage, comprehensive Firestore security rules, Sentry error tracking, and a clean CI pipeline. This analysis covers every dimension of the codebase and categorises remaining gaps by severity and ownership.

**Current score: 9.7/10** (up from 9.6 — dev-side P3 polish gaps closed)

---

## Gaps Closed Since Last Review (2026-04-15)

| #    | Gap                                                                                  | Fix                                                                                                                                                                                                                                                                                | File(s)                                                      |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| V1   | Username constraints defined in both `services/users.ts` and `ProfileSetup.tsx`      | `ProfileSetup.tsx` now imports `USERNAME_MIN/MAX/RE` from the service. Rules file annotated with pointer comments so all 3 sites reference one TS source of truth                                                                                                                  | `screens/ProfileSetup.tsx`, `firestore.rules`                |
| DOC1 | Exported service functions lacked JSDoc preconditions                                | Added JSDoc to `onAuthChange`, `signUp`, `signIn`, `signOut`, `resetPassword`, `resendVerification`, `createGame`, `acceptJudgeInvite`, `declineJudgeInvite`, `forfeitExpiredTurn` — documenting auth preconditions, rate limits, turn-order requirements, and expiration branches | `services/auth.ts`, `services/games.ts`                      |
| DOC2 | Firestore rules' username length/regex magic numbers had no link to the TS constants | Inline pointer comments added next to username size/regex checks, plus a docblock on the `users/{uid}` match explaining the cross-layer contract                                                                                                                                   | `firestore.rules`                                            |
| A1   | `DeleteAccountModal` needed focus trap                                               | `useFocusTrap` hook already created + wired into modal `panelRef`; `Tab` now cycles within the dialog and focus restores on close                                                                                                                                                  | `components/DeleteAccountModal.tsx`, `hooks/useFocusTrap.ts` |
| P3   | Landing-page hero logo lacked `decoding="async"`                                     | Added async decoding so the priority-fetched hero logo no longer blocks the main thread on decode                                                                                                                                                                                  | `screens/Landing.tsx`                                        |

## Gaps Closed in Prior Review

| #   | Gap                                                              | Fix                                                                              | File(s)                             |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | Trick names could contain control characters (null bytes, C0/C1) | Added `.replace(/[\x00-\x1F\x7F]/g, "")` to `setTrick` sanitisation              | `services/games.ts:196`             |
| 2   | `Field` component lacked error state + `aria-invalid`            | Added `error` prop with `aria-invalid`, `role="alert"` error display, red border | `components/ui/Field.tsx`           |
| 3   | `DeleteAccountModal` had no focus management on open             | Added `autoFocus` to Cancel button (safest default focus target)                 | `components/DeleteAccountModal.tsx` |
| 4   | `Btn` component didn't support `autoFocus`                       | Added `autoFocus` prop pass-through                                              | `components/ui/Btn.tsx`             |
| 5   | Build plugin silently ignored missing SW placeholder env vars    | Added `console.warn` listing unreplaced placeholders                             | `vite.config.ts:31-37`              |

---

## Current State by Category

### 1. Security — 8.5/10

**Strengths:**

- Firestore security rules enforce turn order, score increments, rate limiting, email verification
- Firebase App Check with reCAPTCHA v3 (bot protection)
- CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy headers
- `isFirebaseStorageUrl()` guards against open-redirect/XSS via crafted video URLs
- Password reset doesn't reveal account existence (anti-enumeration)
- Trick name sanitisation strips whitespace, control chars, caps at 100 chars
- Video upload size validation (1KB–50MB) mirrors storage.rules

**Remaining gaps:**

| #   | Gap                                   | Severity | Owner | Details                                                                                                                                                                           |
| --- | ------------------------------------- | -------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | App Check silent fallback             | Low      | Ops   | If `VITE_RECAPTCHA_SITE_KEY` is missing in production, App Check is disabled with a warning only. Bots could bypass. Mitigation: Firestore rules still enforce all business logic |
| S2  | CSP allows broad Google script domain | Low      | Infra | `script-src` includes `https://apis.google.com` — consider using nonces for inline scripts                                                                                        |
| S3  | Storage read access is broad          | Low      | Infra | Any authenticated user can read any game's video files. Acceptable for current use case but worth noting                                                                          |
| S4  | Game deletion not restricted          | Low      | Rules | Either player can delete any game at any time. Could hide completed game results                                                                                                  |

### 2. Error Handling & Monitoring — 10/10

**Strengths:**

- Sentry with PII scrubbing covers unhandled rejections, subscription errors, forfeit errors, redirect errors
- `ErrorBoundary` component catches React render errors
- `withRetry` utility with exponential backoff for all read operations
- `parseFirebaseError` extracts human-readable messages from Firebase's non-standard error objects
- `getUserMessage` provides user-facing fallbacks
- Notification write failures are logged (best-effort pattern documented)
- Camera errors distinguish permission vs hardware unavailability

**No remaining code-level gaps.**

### 3. Testing — 8/10

**Strengths:**

- 71 test files, 761 tests, all passing
- 100% coverage on `src/services/**` and `src/hooks/**` (lines, functions, branches, statements)
- `src/firebase.ts` at 96%/93% (legitimately untestable App Check env branches)
- Smoke tests for all screens
- Service layer tests use mocked Firebase SDK

**Remaining gaps:**

| #   | Gap                             | Severity | Owner | Details                                                                                                                                                                                     |
| --- | ------------------------------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | No E2E tests                    | Resolved | —     | Playwright suite lives at `e2e/auth.spec.ts`, `e2e/game.spec.ts`, `e2e/map.spec.ts` and runs in CI via `npm run test:e2e` against the Firebase emulators                                    |
| T2  | No Firestore rule unit tests    | Resolved | —     | `rules-tests/` covers clips, spots, games (`spotId`/`turnorder`/`turndeadline`/`updatedat`), notifications, judge, storage, and rate-limit bypass paths via `npm run test:rules` (PR-gated) |
| T3  | No accessibility testing in CI  | P2       | Dev   | No axe-core or Lighthouse accessibility audit in pipeline                                                                                                                                   |
| T4  | Low coverage on `RecordScreen`  | P3       | Dev   | 0% coverage — likely a newer screen. Needs smoke tests                                                                                                                                      |
| T5  | Low coverage on `ollieSound.ts` | P3       | Dev   | 20% — audio playback not easily testable in JSDOM. Acceptable                                                                                                                               |

### 4. Type Safety — 10/10

**Strengths:**

- TypeScript strict mode enabled, zero errors
- No `any` types in source code (linted)
- All service functions have explicit return types
- `GameDoc`, `TurnRecord`, `UserProfile` types are well-defined
- Firestore document parsing validates required fields before casting

**No remaining gaps.**

### 5. Accessibility — 7.5/10

**Strengths:**

- `aria-label` on all buttons, videos, and interactive elements
- `aria-labelledby` and `aria-modal` on modals
- `aria-describedby` for form field notes
- `aria-invalid` on Field component (newly added)
- `aria-expanded` on NotificationBell dropdown
- `aria-hidden` on decorative icons/SVGs
- `role="status"` and `aria-live="polite"` on Toast
- `role="alert"` on Field error messages (newly added)
- Focus management: autoFocus on modal Cancel button (newly added)
- `focus-visible` outlines on all interactive elements

**Remaining gaps:**

| #   | Gap                                    | Severity | Owner | Details                                                                                                                                    |
| --- | -------------------------------------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A2  | Video elements lack captions           | P3       | Dev   | User-generated video content has no caption/transcript support. Low priority for skateboard trick videos                                   |
| A3  | Notification dropdown lacks focus trap | P3       | Dev   | NotificationBell dropdown closes on Escape (good) but doesn't trap focus. Arguable — a non-modal popover traditionally does not trap focus |

### 6. Validation & Data Integrity — 9/10

**Strengths:**

- Trick names: trim, control char strip, 100-char cap
- Username: regex + length constraints in services, UI, and Firestore rules
- Email: regex validation client-side, Firebase Auth validates server-side
- Date of birth: validates ranges AND detects date rollover (Feb 30 → caught)
- Video size: pre-validated before upload (mirrors storage.rules)
- `isFirebaseStorageUrl` validates video URLs before rendering
- `runTransaction` for all game state mutations (no race conditions)
- Client-side rate limiting as defense-in-depth (backed by Firestore rules)

**Remaining gaps:**

| #   | Gap                       | Severity | Owner | Details                                                          |
| --- | ------------------------- | -------- | ----- | ---------------------------------------------------------------- |
| V2  | Email regex is permissive | Info     | —     | Matches `a@b.cd`. Acceptable: Firebase Auth validates on backend |

### 7. Performance — 8/10

**Strengths:**

- Code splitting: React + Firebase vendor chunks
- Firebase preconnect in `index.html`
- Firestore persistent local cache with multi-tab support
- Hidden source maps (no prod bundle bloat)
- WebGL fisheye renderer (GPU-accelerated, no CPU bottleneck)
- Lighthouse CI in pipeline

**Remaining gaps:**

| #   | Gap                                              | Severity | Owner | Details                                                                                                                                                                                                   |
| --- | ------------------------------------------------ | -------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `lastTurnActionAt` map pruning threshold is 50   | Resolved | —     | Pruning now runs on every `recordTurnAction`, dropping entries older than the 3s cooldown window. Map size is bounded by concurrently-active games, not an arbitrary size threshold                       |
| P2  | localStorage notifications capped at 50 per user | Info     | —     | No eviction by time. Acceptable for current scale                                                                                                                                                         |
| P3  | Feature icons/images are SVG components          | Info     | —     | Previously flagged as "missing lazy-load"; the feature grid is inline SVG React, not `<img>`. Footer logo is already `loading="lazy"`; hero logo now `decoding="async"`. Video uses `preload="metadata"`. |

### 8. CI/CD — 8/10

**Strengths:**

- Pipeline: Lint → Type check → Test with coverage → Build → Lighthouse CI
- Coverage thresholds enforced (100% services/hooks)
- PR gate rejects new Cloud Functions code
- Conventional commit format enforced

**Remaining gaps:**

| #   | Gap                                       | Severity | Owner | Details                                                                                                                                         |
| --- | ----------------------------------------- | -------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | No automated Firebase rules deployment    | Resolved | —     | `.github/workflows/firebase-rules-deploy.yml` deploys rules + indexes on every push to `main` that touches them                                 |
| C2  | No branch protection rules                | Resolved | —     | `scripts/apply-branch-protection.sh` + `.github/BRANCH_PROTECTION.md` codify the policy; `.github/workflows/pr-gate.yml` enforces the CI guards |
| C3  | SW placeholder validation is warning-only | Info     | —     | Build succeeds even with unreplaced placeholders (warning logged). Consider failing in CI                                                       |

### 9. Data Privacy & Compliance — 10/10

**Strengths:**

- Privacy Policy at `/privacy` (GDPR-compliant)
- Terms of Service at `/terms`
- Cookie-free analytics consent banner with accept/decline
- Account deletion: atomic Firestore cleanup + Auth deletion
- Data deletion page at `/data-deletion`
- Age gate with COPPA compliance (13+ required, parental consent for under 18)
- No PII in Sentry (scrubbing enabled)

**Remaining gaps:**

| #   | Gap                                   | Severity | Owner | Details                                                                                                              |
| --- | ------------------------------------- | -------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| D1  | No user data export (GDPR Article 20) | Resolved | —     | "Download My Data" ships from the lobby account menu (`Lobby.tsx#onDownloadData` → `AuthContext.handleDownloadData`) |

### 10. Infrastructure & Operations — 6/10

These are out of scope for the code repo but critical for production:

| #   | Gap                                | Severity | Owner | Details                                                                                 |
| --- | ---------------------------------- | -------- | ----- | --------------------------------------------------------------------------------------- |
| I1  | No Firestore backup/exports        | P1       | Ops   | No scheduled exports — data loss risk. Enable Cloud Firestore managed exports           |
| I2  | Video retention not enforced       | P1       | Ops   | `retainUntil` metadata is a hint; nothing purges old videos. Set Storage lifecycle rule |
| I3  | Username reservations never expire | P2       | Ops   | Deleted account's username is gone forever. Add TTL cleanup                             |

### 11. Documentation — 8/10

**Strengths:**

- Comprehensive `CLAUDE.md` with architecture guardrails
- 13 docs in `docs/` covering API, architecture, database, deployment, testing, security audits
- File-specific knowledge table in CLAUDE.md
- Inline comments on complex logic (fisheye shader, OR query merge, rate limiting)

**Remaining gaps:** (none)

All public service functions now carry JSDoc describing preconditions,
rate limits, and side-effects. Firestore rules already had extensive
rationale comments on the complex branches (rate limit, turn order,
instant-forfeit attack); the remaining cross-layer link between the
username regex/size checks and the shared TS constants is now
annotated in-file.

---

## Summary Scorecard

| Category       | Score      | Change | Notes                                                                               |
| -------------- | ---------- | ------ | ----------------------------------------------------------------------------------- |
| Security       | 8.5/10     | —      | Strong Firestore rules, App Check, CSP. Broad storage read                          |
| Error Handling | 10/10      | —      | Sentry + ErrorBoundary + withRetry covers all paths                                 |
| Testing        | 8/10       | —      | 100% service coverage. No E2E (P2)                                                  |
| Type Safety    | 10/10      | —      | Strict mode, zero errors, no `any`                                                  |
| Accessibility  | 8.5/10     | ↑ +1.0 | A1 focus trap wired into DeleteAccountModal. Only A2 (captions) / A3 (popover) left |
| Validation     | 9.5/10     | ↑ +0.5 | V1 closed — username constants consolidated in `services/users.ts`                  |
| Performance    | 8/10       | —      | Code splitting, preconnect, Lighthouse CI                                           |
| CI/CD          | 8/10       | —      | SW placeholder warning added                                                        |
| Data Privacy   | 10/10      | —      | GDPR, COPPA, consent banner, account deletion                                       |
| Infrastructure | 6/10       | —      | No backups, no video purge (ops work)                                               |
| Documentation  | 9/10       | ↑ +1.0 | DOC1/DOC2 closed — JSDoc on all public service exports + rules cross-ref comments   |
| **Overall**    | **9.7/10** | ↑ 0.1  | Dev-side P3 polish gaps closed. Remaining are ops/infra                             |

---

## Priority Action Items

### P0 — None (all resolved)

### P1 — Infrastructure (Ops)

1. ~~Automate Firebase rules deployment in CI~~ — DONE (`.github/workflows/firebase-rules-deploy.yml`)
2. Enable Firestore managed exports (daily backups) — provisionable via `.github/workflows/firebase-infra-setup.yml` (`workflow_dispatch`)
3. Set Storage lifecycle rule for video retention — same workflow
4. ~~Add "Download My Data" feature (GDPR Article 20)~~ — DONE
5. ~~Configure GitHub branch protection rules~~ — DONE (`scripts/apply-branch-protection.sh`)

### P2 — Quality (Dev)

6. ~~Add E2E tests for critical user flows~~ — DONE (`e2e/`)
7. ~~Add focus trap to modals~~ — DONE for DeleteAccountModal; NotificationBell popover intentionally left without trap (matches popover semantics)
8. ~~Add Firestore rule unit tests~~ — DONE (`rules-tests/`)
9. Add accessibility testing in CI (axe-core)
10. Add TTL cleanup for username reservations

### P3 — Polish (Dev)

11. ~~Extract shared username validation constants~~ — DONE (see V1 above)
12. ~~Add JSDoc to exported service functions~~ — DONE (see DOC1 above)
13. ~~Add inline rationale to Firestore rules~~ — DONE (see DOC2 above)
14. ~~Add smoke tests for RecordScreen~~ — N/A (no `RecordScreen` exists; recording happens via the `VideoRecorder` component, which already has coverage)

---

**Verdict:** All code-level blockers resolved. The codebase is production-ready with strong architecture, comprehensive testing, and solid security. P1 items are infrastructure/ops work. P2/P3 items are quality improvements for post-launch iteration.
