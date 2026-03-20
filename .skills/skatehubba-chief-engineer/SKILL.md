# SkateHubba Chief Engineer

You are the chief engineer for **SkateHubba S.K.A.T.E.** — a real-time multiplayer game of S.K.A.T.E. played with video trick clips.

## Architecture Overview

SkateHubba is a **zero-backend single-page application (SPA)**. There is no custom server, no REST API, and no serverless functions (aside from a small Cloud Functions trigger). The React client talks directly to Firebase services, with **Firestore security rules** as the sole authorization and validation layer.

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| **Framework** | React 18 + TypeScript 5.6 | SPA only — no SSR, no React Router |
| **Build** | Vite 6 | Manual chunks for Firebase and React |
| **Styling** | Tailwind CSS 3.4 | Utility-first; custom brand tokens (Orange #FF6B00, Green #00E676) |
| **Database** | Cloud Firestore | Named database `"skatehubba"` (not default); offline persistence enabled |
| **Auth** | Firebase Authentication | Email/password + Google OAuth (popup with redirect fallback) |
| **Storage** | Firebase Storage | WebM video files only; 1 KB – 50 MB limit |
| **Hosting** | Vercel | Auto-deploys from GitHub `main`; SPA rewrite to `index.html` |
| **Testing** | Vitest 4 + Testing Library + Playwright | Unit/integration + E2E with Firebase emulators |
| **Linting** | ESLint 9 + Prettier 3.8 | Husky + lint-staged pre-commit hooks |
| **Monitoring** | Sentry (errors) + Vercel Analytics | Optional via env vars |
| **CI/CD** | GitHub Actions | Type check → test → build gate |
| **Cloud Functions** | Firebase Functions (TypeScript) | Minimal — Firestore triggers only |
| **Node** | 22+ | Enforced via `engines` and `.nvmrc` |

## Key Architectural Decisions

- **No URL routing.** All screen state is a single `useState` in `App.tsx`. The app has a linear flow: landing → auth → lobby → game.
- **No custom backend.** Business logic lives in Firestore security rules. Client-side validation is for UX only.
- **Transactions for all game writes.** `runTransaction` ensures atomic read-then-write for game state transitions.
- **Dual queries for OR logic.** Two parallel `onSnapshot` queries (player1Uid, player2Uid) merged in memory — Firestore doesn't support cross-field OR.
- **Offline-first.** `persistentLocalCache` + `persistentMultipleTabManager` for reads without network.
- **PWA installable.** Manifest with standalone display mode, service workers for push notifications.

## Project Structure

```
skatehubba-play/
├── src/
│   ├── App.tsx              # Screen state machine + auth guard
│   ├── firebase.ts          # Conditional Firebase init + emulator support
│   ├── services/            # All Firebase SDK calls (auth, users, games, storage)
│   ├── hooks/               # useAuth wraps onAuthStateChanged + profile fetch
│   ├── components/          # UI components (Tailwind classes only)
│   ├── screens/             # Full-page screen components
│   ├── context/             # React context providers (Game, Notification)
│   ├── lib/                 # Utilities (Sentry, notification metadata)
│   └── __tests__/           # Integration & smoke tests
├── functions/               # Firebase Cloud Functions (TypeScript)
├── e2e/                     # Playwright E2E tests
├── public/                  # PWA manifest, service workers, static assets
├── firestore.rules          # Firestore security rules (the real backend)
├── storage.rules            # Storage security rules
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
- **Not backed by PostgreSQL/Neon/Drizzle.** The database is Cloud Firestore (NoSQL document store).
- **Not a native mobile app.** No Expo, no React Native. It's a web PWA.
- **Not using any ORM.** Direct Firestore SDK calls through the services layer.

## Security Model

Firestore rules are the authority. They enforce:
- Authentication gates on all reads/writes
- Game state machine transitions (turn order, valid actions)
- Score inflation prevention (increments by 0 or 1 only)
- Atomic username reservation (prevents race conditions)
- Rate limiting (game creation, nudges)
- 24-hour turn timer enforcement

Client-side checks mirror the rules for UX but provide zero security guarantee.
