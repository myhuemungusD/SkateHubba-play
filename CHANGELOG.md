# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **URL routing via `react-router-dom` v7.** `App.tsx` now declares a full `<Routes>` tree covering every screen (`/`, `/age-gate`, `/auth`, `/profile`, `/lobby`, `/challenge`, `/game`, `/gameover`, `/record`, `/player/:uid`, `/privacy`, `/terms`, `/data-deletion`, `/map`, `/spots/:id`, `/404`, plus a `*` catch-all). `NavigationContext.setScreen` bridges legacy callsites to `useNavigate()`, so the browser back/forward buttons and deep links now work.
- **Native iOS + Android apps via Capacitor 8** (`@capacitor/ios`, `@capacitor/android`, `@capacitor/camera`). Android AAB builds run via `.github/workflows/android-aab.yml`.
- **Server-side turn-timer enforcement.** A new `checkExpiredTurns` scheduled Cloud Function (`functions/src/index.ts`) runs every 15 minutes and auto-forfeits active games whose `turnDeadline` has passed — closing the "dodge loss by staying offline" P0 tracked in `docs/P0-SECURITY-AUDIT.md`.
- **Push-notification Cloud Functions**: `onNudgeCreated`, `onGameCreated`, `onGameUpdated` (FCM multicast with stale-token cleanup and win/loss stats as a side-effect).
- **Billing-alert Cloud Function**: `onBillingAlert` persists budget-threshold Pub/Sub events to the `billingAlerts` Firestore collection for ops review.
- **Firestore `notifications` collection rules**, closing the CRITICAL finding from `docs/P0-SECURITY-AUDIT.md`.
- **MP4 upload support** for the native Capacitor shells, alongside the existing WebM path for the web build. `storage.rules` now allowlists `(set|match)\.(webm|mp4)` and requires the content-type to match the extension.
- **Playwright E2E suite** (`e2e/`) and **Firestore rules unit tests** (`rules-tests/`), both running against Firebase emulators in CI.
- **Split smoke-test suites**: `smoke-auth`, `smoke-google`, `smoke-profile`, `smoke-lobby`, `smoke-challenge`, `smoke-gameplay`, `smoke-gameover`, `smoke-account` (plus shared `smoke-helpers.tsx`).
- **Branch protection + CODEOWNERS**: `.github/BRANCH_PROTECTION.md` documents the full `main` ruleset; `.github/CODEOWNERS` requires review from `@myhuemungusD` on every PR.
- **PR gate guards**: `verify-no-cloud-functions`, `guard-as-any-casts`, `guard-todo-fixme-hack`, and `verify-workflow-changes` (`.github/workflows/pr-gate.yml`).
- **Lint + format toolchain**: ESLint 9 (flat config) + Prettier 3.8, with Husky + lint-staged pre-commit hooks.

### Changed

- **Upgraded major dependencies**: React 18 → 19, Vite 6 → 8 (Rolldown), Tailwind CSS 3 → 4 (`@tailwindcss/vite` plugin), Firebase SDK 11 → 12.
- **Hardened Firestore rules** — F9 (instant-forfeit via crafted game create), F10 (leaderboard inflation via stats injection), F11 (confirmation bypass via normal update rule), and F12 (confirmation turnHistory lock) are all fixed. See `docs/FIRESTORE_SECURITY_AUDIT.md`.
- **Forfeit deadline validation** on the server-side rule (`request.time > resource.data.turnDeadline`), closing DATABASE_AUDIT F1.
- **Confirmation phase locks** additional game-state fields during vote-only writes, closing DATABASE_AUDIT F2 and its follow-up F2b.
- **CI pipeline**: lint → type check → `test:coverage` → build → Lighthouse CI → Playwright E2E (on Firebase emulators).

### Fixed

- **Documentation sync** — SKILL.md, ARCHITECTURE.md, DEVELOPMENT.md, GAME_STATE_MACHINE.md, TECH_DEBT.md, DATABASE.md, API.md, GAME_MECHANICS.md, SECURITY.md, P0-SECURITY-AUDIT.md, DATABASE_AUDIT.md, COMPREHENSIVE_GAP_ANALYSIS.md, CLAUDE.md, CONTRIBUTING.md, README.md, and the archived audits now match the current stack (React 19 / Vite 8 / Tailwind 4 / Firebase 12 / Capacitor 8 / `react-router-dom` v7), the split smoke-test layout, server-side turn-timer enforcement, and the WebM + MP4 storage policy. Dead `DEPENDENCY_AUDIT.md` references have been removed.

---

## [1.0.0] — 2024-12-01

Initial production release of the SkateHubba S.K.A.T.E. async trick battle game.

### Added

**Authentication**

- Email/password sign-up with automatic verification email
- Email/password sign-in (requires verified email)
- Google OAuth sign-in via popup, with automatic redirect fallback for browsers that block popups (mobile, Safari)
- Password reset via email link
- Resend verification email from within the app
- Email verification banner shown to unverified users

**User Profiles**

- Unique username reservation using a Firestore transaction (prevents race conditions)
- Username validation: 3–20 characters, lowercase alphanumeric and underscore only
- Skateboarding stance selection: Regular or Goofy
- Profile created atomically with username reservation on first login

**Game Loop**

- Challenge any player by username
- Setting phase: name your trick and record a one-take video
- Matching phase: watch the setter's video and record your attempt
- Self-judging: report whether you landed or missed
- Scoring: a missed trick earns the matcher one S.K.A.T.E. letter
- Win condition: first player to accumulate 5 letters (S-K-A-T-E) loses
- Rematch option after game completion

**Real-Time Updates**

- Both players see game state changes the moment they occur via Firestore `onSnapshot` listeners
- Lobby shows all active and completed games, sorted by activity

**Turn Timer**

- 24-hour deadline per turn
- Deadline is reset to 24 hours from the current time on each turn transition
- Expired turns are automatically forfeited when a player opens the game

**Video Recording**

- In-browser one-take recording using the MediaRecorder API (WebM format)
- Upload to Firebase Storage with size validation (1 KB – 50 MB)
- Video playback in-app for the matching player

**Security**

- Firestore security rules enforce all game logic server-side
- Storage rules enforce authentication, file size limits, content type, and filename allowlist
- Firebase Storage URL validation before rendering any video element
- No custom backend — attack surface limited to Firebase and Vercel

**Infrastructure**

- Vercel hosting with SPA routing (`index.html` fallback)
- Vercel Analytics for page view tracking
- GitHub Actions CI: type check → test → build on every push to `main` and on PRs
- Progressive Web App manifest (installable on iOS and Android)
- Offline read support via Firestore `persistentLocalCache`
- Dark theme with custom brand tokens (orange, green, red, dark surfaces)

---

[Unreleased]: https://github.com/myhuemungusD/skatehubba-play/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/myhuemungusD/skatehubba-play/releases/tag/v1.0.0
