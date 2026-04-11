# SkateHubba Chief Engineer

You are the chief engineer for **SkateHubba S.K.A.T.E.** — a real-time multiplayer game of S.K.A.T.E. played with video trick clips.

## Architecture Overview

SkateHubba is a **Firebase-backed single-page application (SPA)** shipped to the web (Vercel) and as native iOS/Android apps (Capacitor). There is no custom server and no REST API — the React client talks directly to Firebase services, with **Firestore security rules** as the primary authorization and validation layer. A small set of Cloud Functions handles side-effects that must not run on the client (push notifications, billing alerts, scheduled turn-expiration enforcement).

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| **Framework** | React 19 + TypeScript 5.6 | SPA with `react-router-dom` v7 URL routing |
| **Build** | Vite 8 (Rolldown) | Manual chunks for Firebase and React |
| **Styling** | Tailwind CSS 4 | Utility-first; `@tailwindcss/vite` plugin; custom brand tokens (Orange #FF6B00, Green #00E676) |
| **Database** | Cloud Firestore | Named database `"skatehubba"` (not default); offline persistence enabled |
| **Auth** | Firebase Authentication | Email/password + Google OAuth (popup with redirect fallback) |
| **Storage** | Firebase Storage | Trick videos — WebM on web, MP4 on native (Capacitor); 1 KB – 50 MB |
| **Hosting** | Vercel | Auto-deploys from GitHub `main`; SPA rewrite to `index.html` |
| **Native** | Capacitor 8 (iOS + Android) | `@capacitor/ios`, `@capacitor/android`, `@capacitor/camera` |
| **Testing** | Vitest 4 + Testing Library + Playwright | Unit/integration + E2E with Firebase emulators |
| **Linting** | ESLint 9 + Prettier 3.8 | Flat config; Husky + lint-staged pre-commit hooks |
| **Monitoring** | Sentry (errors) + Vercel Analytics + Speed Insights | Optional via env vars |
| **CI/CD** | GitHub Actions | Lint → type check → test:coverage → build → Lighthouse CI + E2E (Playwright) |
| **Cloud Functions** | Firebase Functions (TypeScript) | Push notifications, billing alerts, `checkExpiredTurns` scheduled forfeit |
| **Firebase SDK** | v12 | Modular imports; App Check via reCAPTCHA v3 (optional) |
| **Node** | 22+ | Enforced via `engines` |

## Key Architectural Decisions

- **URL routing via `react-router-dom` v7.** All routes live in `App.tsx` as `<Route>` elements. Screen transitions go through `NavigationContext.setScreen`, which the router uses to drive navigation. Public pages (`/privacy`, `/terms`, `/data-deletion`, `/map`, `/spots/:id`, `/player/:uid`) are deep-linkable; the catch-all `*` route redirects to `/404`.
- **No custom backend.** Business logic lives in Firestore security rules; client-side validation is for UX only. A small set of Cloud Functions handles push notifications, billing alerts, and server-side turn-timer enforcement.
- **Transactions for all game writes.** `runTransaction` ensures atomic read-then-write for every game state transition.
- **Dual queries for OR logic.** Two parallel `onSnapshot` queries (`player1Uid`, `player2Uid`) merged in memory — Firestore doesn't support cross-field OR.
- **Offline-first.** `persistentLocalCache` + `persistentMultipleTabManager` for reads without network.
- **Server-side turn-timer enforcement.** The `checkExpiredTurns` scheduled Cloud Function runs every 15 minutes and auto-forfeits active games whose `turnDeadline` has passed. The client also calls `forfeitExpiredTurn()` on game open as defense-in-depth.
- **PWA + native shells.** Web bundle is installable via manifest + service worker; Capacitor wraps the same bundle for iOS/Android store submission.

## Project Structure

```
skatehubba-play/
├── src/
│   ├── App.tsx              # Router + auth guard + NavigationContext bridge
│   ├── firebase.ts          # Conditional Firebase init + emulator support
│   ├── services/            # All Firebase SDK calls (auth, users, games, storage, analytics, notifications)
│   ├── hooks/               # useAuth, useOnlineStatus, usePlayerProfile, etc.
│   ├── components/          # UI components (Tailwind classes only)
│   ├── screens/             # Full-page screen components
│   ├── context/             # React context providers (Auth, Game, Navigation, Notification)
│   ├── lib/                 # Utilities (Sentry, notification metadata)
│   └── __tests__/           # Integration & smoke tests
├── functions/               # Firebase Cloud Functions (TypeScript) — push, billing, scheduled forfeit
├── e2e/                     # Playwright E2E tests (run against Firebase emulators)
├── rules-tests/             # Firestore security-rule unit tests
├── ios/ + android/          # Capacitor native projects
├── public/                  # PWA manifest, service workers, static assets
├── firestore.rules          # Firestore security rules (the real backend)
├── storage.rules            # Storage security rules (WebM + MP4)
├── vercel.json              # Vercel config (rewrites, headers, CSP)
└── docs/                    # Architecture, database, testing, deployment docs
```

## Code Conventions

- **Services layer:** All Firebase SDK calls live in `src/services/`. Components never import Firebase directly.
- **Styling:** Tailwind utility classes only — no CSS modules, no inline styles, no `styled-components`.
- **Fonts:** Bebas Neue (display/headings), DM Sans (body text).
- **Testing:** 100% coverage required on services and hooks. Firebase mocks are centralized in `src/__mocks__/firebase.ts`.
- **Type safety:** TypeScript strict mode. Explicit return types on exported service functions. No `as any` in production code (CI-enforced).
- **Linting:** ESLint 9 flat config + Prettier 3.8. Husky + lint-staged run on pre-commit.

## What This Project Is NOT

- **Not Next.js.** No SSR, no API routes, no `app/` directory, no server components.
- **Not backed by PostgreSQL/Neon/Drizzle.** The database is Cloud Firestore (NoSQL document store).
- **Not using any ORM.** Direct Firestore SDK calls through the services layer.
- **Not a full-backend app.** Cloud Functions exist only for push notifications, billing alerts, and scheduled turn-expiration enforcement — never for general business logic. The PR gate (`.github/workflows/pr-gate.yml`) rejects modifications under `functions/src/` without explicit maintainer approval.

## Security Model

Firestore rules are the authority. They enforce:
- Authentication gates on all reads/writes
- Game state machine transitions (turn order, valid phase changes, confirmation lock)
- Score inflation prevention (increments by 0 or 1 only)
- Atomic username reservation (prevents race conditions)
- Rate limiting (game creation, nudges)
- 24-hour turn timer enforcement — both client-triggered and server-scheduled via `checkExpiredTurns`

Client-side checks mirror the rules for UX but provide zero security guarantee.
