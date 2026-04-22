# SkateHubba Chief Engineer

You are the chief engineer for **SkateHubba S.K.A.T.E.** — a real-time multiplayer game of S.K.A.T.E. played with video trick clips.

## Architecture Overview

SkateHubba is a **zero-backend single-page application (SPA)**. There is no custom server, no REST API, and no serverless functions. The React client talks directly to Firebase services, with **Firestore security rules** as the sole authorization and validation layer.

## Technology Stack

| Layer               | Technology                              | Notes                                                                                                                                                                    |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Framework**       | React 19 + TypeScript 5.6               | SPA only — no SSR. Client-side routing via `react-router-dom` v7                                                                                                         |
| **Build**           | Vite 8                                  | Manual chunks for Firebase and React                                                                                                                                     |
| **Styling**         | Tailwind CSS 4                          | Utility-first; custom brand tokens (Orange #FF6B00, Green #00E676)                                                                                                       |
| **Database**        | Cloud Firestore                         | Named database `"skatehubba"` (not default); offline persistence enabled                                                                                                 |
| **Auth**            | Firebase Authentication                 | Email/password + Google OAuth (popup with redirect fallback)                                                                                                             |
| **Storage**         | Firebase Storage                        | WebM (web) and MP4 (native/Capacitor); 1 KB – 50 MB limit                                                                                                                |
| **Maps**            | Mapbox GL JS                            | Used by the skate-spots map feature (read-only tiles, no backend)                                                                                                        |
| **Native shell**    | Capacitor (iOS + Android)               | Wraps the PWA into native iOS/Android app-store builds                                                                                                                   |
| **Hosting**         | Vercel                                  | Auto-deploys from GitHub `main`; SPA rewrite to `index.html`                                                                                                             |
| **Testing**         | Vitest 4 + Testing Library + Playwright | Unit/integration + E2E with Firebase emulators                                                                                                                           |
| **Linting**         | ESLint 9 + Prettier 3.8                 | Husky + lint-staged pre-commit hooks                                                                                                                                     |
| **Monitoring**      | Sentry (errors) + Vercel Analytics + Vercel Speed Insights + PostHog (product analytics) | All optional via env vars; PostHog identifies users on auth and resets on sign-out                                                                      |
| **CI/CD**           | GitHub Actions                          | Lint → type check → test w/ coverage → build → Lighthouse CI                                                                                                             |
| **Cloud Functions** | None                                    | The `functions/` package has been removed. New code under any `functions/src/` path is rejected by the PR gate and requires explicit maintainer approval to re-introduce |
| **Node**            | 22+                                     | Enforced via `engines` and `.nvmrc`                                                                                                                                      |

## Key Architectural Decisions

- **URL routing via `react-router-dom` only.** `App.tsx` defines every `<Route>`; screen transitions go through `NavigationContext.setScreen`. Non-critical screens (ChallengeScreen, GamePlayScreen, GameOverScreen, PlayerProfileScreen, MapPage, SpotDetailPage, Settings, legal pages, NotFound) are `lazy()`-imported and wrapped in `<Suspense>`; Landing/AuthScreen/ProfileSetup/Lobby are eager for first-paint. Typical flow: `/` → `/auth` → (`/profile` for post-Google fallback) → `/lobby` → `/challenge` → `/game` → `/gameover`, with `/map`, `/spots/:id`, `/player/:uid`, `/record`, and `/settings` branching off the lobby. Legal pages live at `/privacy`, `/terms`, `/data-deletion`; `/feed` redirects to `/lobby`; unknown paths fall through to `/404`. DOB + parental consent are collected inline on AuthScreen (COPPA/CCPA) — there is no standalone `/age-gate` route.
- **No custom backend.** Business logic lives in Firestore security rules. Client-side validation is for UX only.
- **No state-management or UI-component libraries.** React local state + hooks + context is sufficient; Tailwind utilities + custom components keep the bundle lean.
- **Transactions for all game writes.** `runTransaction` ensures atomic read-then-write for game state transitions.
- **Dual queries for OR logic.** Two parallel `onSnapshot` queries (player1Uid, player2Uid) merged in memory — Firestore doesn't support cross-field OR.
- **Offline-first.** `persistentLocalCache` + `persistentMultipleTabManager` for reads without network.
- **PWA installable + Capacitor-wrapped.** Web manifest with standalone display mode and service workers for push notifications; the same bundle ships to iOS and Android via Capacitor.

## Project Structure

```
skatehubba-play/
├── src/
│   ├── App.tsx              # Route table + auth guard + screen state machine
│   ├── firebase.ts          # Conditional Firebase init + emulator support
│   ├── services/            # All Firebase SDK calls — auth, users, userData, games, spots, clips,
│   │                        # storage, nativeVideo, notifications, fcm, nudge, blocking, reports,
│   │                        # analytics, haptics, sounds, logger
│   ├── hooks/               # useAuth wraps onAuthStateChanged + profile fetch
│   ├── components/          # UI components (Tailwind classes only)
│   ├── screens/             # Full-page screen components
│   ├── context/             # React context providers (Auth, Navigation, Game, Notification)
│   ├── lib/                 # Utilities (Sentry, PostHog, consent, env validation, notification metadata, mapbox)
│   ├── constants/           # Shared string/number constants
│   ├── types/               # Cross-cutting TypeScript types (e.g. Spot)
│   ├── utils/               # Pure helpers (no Firebase, no React)
│   ├── __mocks__/           # Centralized Firebase SDK mocks for vitest
│   └── __tests__/           # Integration & smoke tests
├── e2e/                     # Playwright E2E tests
├── rules-tests/             # Firestore rules unit tests (@firebase/rules-unit-testing)
├── android/                 # Capacitor Android project
├── public/                  # PWA manifest, service workers, static assets
├── firestore.rules          # Firestore security rules (the real backend)
├── storage.rules            # Storage security rules
├── capacitor.config.ts      # Capacitor native-shell config
├── vercel.json              # Vercel config (rewrites, headers, CSP)
└── docs/                    # Architecture, database, testing, deployment docs
```

## Code Conventions

- **Services layer:** All Firebase SDK calls live in `src/services/`. Components never import Firebase directly.
- **Styling:** Tailwind utility classes only — no CSS modules, no inline styles, no `styled-components`.
- **Fonts:** Bebas Neue (display/headings), DM Sans (body text).
- **Testing:** 100% coverage required on services and hooks. Firebase mocks are centralized in `src/__mocks__/firebase.ts`.
- **Type safety:** TypeScript strict mode. Explicit return types on exported service functions.

## What This Project Is NOT

- **Not Next.js.** No SSR, no API routes, no `app/` directory, no server components.
- **Not backed by PostgreSQL/Neon/Drizzle.** The database is Cloud Firestore (NoSQL document store). The previous `apps/api/` Express + Postgres backend was deleted during the charter-compliance pass.
- **Not React Native / Expo.** The native iOS/Android builds come from wrapping the same web PWA in Capacitor — there is no separate native codebase.
- **Not using any ORM.** Direct Firestore SDK calls through the services layer.
- **Not using Redux / Zustand / MobX / TanStack Query.** State-management libraries are explicitly off-charter.

## Security Model

Firestore rules are the authority. They enforce:

- Authentication gates on all reads/writes
- Game state machine transitions (turn order, valid actions)
- Score inflation prevention (increments by 0 or 1 only)
- Atomic username reservation (prevents race conditions)
- Rate limiting (game creation, nudges)
- 24-hour turn timer enforcement

Client-side checks mirror the rules for UX but provide zero security guarantee.
