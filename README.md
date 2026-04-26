<div align="center">

<!-- GitHub dark mode: show white logo; light mode: show black logo -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/logo-white.webp">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/logo-black.png">
  <img src="docs/screenshots/logo-black.png" alt="SkateHubba" width="200">
</picture>

### Own the spot. Play S.K.A.T.E. anywhere.

An async multiplayer trick battle game for skateboarders.
Challenge friends, set tricks on video, and see if they can match you — one letter at a time.

[![Play Now](https://img.shields.io/badge/Play_Now-skatehubba.com-FF6B00?style=for-the-badge&logo=vercel&logoColor=white)](https://skatehubba.com)
[![CI](https://img.shields.io/github/actions/workflow/status/myhuemungusD/SkateHubba-play/main.yml?branch=main&style=for-the-badge&label=CI&logo=githubactions&logoColor=white)](https://github.com/myhuemungusD/SkateHubba-play/actions/workflows/main.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=for-the-badge)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)](CONTRIBUTING.md)

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![Firebase](https://img.shields.io/badge/Firebase-12-DD2C00?style=flat-square&logo=firebase&logoColor=white)](https://firebase.google.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![GitHub Release](https://img.shields.io/github/v/release/myhuemungusD/SkateHubba-play?style=flat-square&label=release&color=FF6B00)](https://github.com/myhuemungusD/SkateHubba-play/releases)

<br>

<img src="docs/screenshots/graffiti-banner.webp" alt="SkateHubba graffiti branding — stacked skateboards against a tagged wall" width="600">

</div>

<br>

## What is S.K.A.T.E.?

S.K.A.T.E. is the skateboarding version of HORSE. One player sets a trick; the other must land it. Miss and you earn a letter — **S**, then **K**, then **A**, then **T**, then **E**. First to spell it out loses.

This app brings that to your phone, async. Set your trick whenever, opponent matches whenever. No need to be at the same spot or online at the same time.

> **Try it now:** [skatehubba.com](https://skatehubba.com) — sign up and start a game in under 30 seconds.

---

## Contents

[Screenshots](#screenshots) · [Tech Stack](#tech-stack) · [Features](#features) · [Quick Start](#quick-start) · [Scripts](#scripts) · [Project Structure](#project-structure) · [Environment Variables](#environment-variables) · [Documentation](#documentation) · [Deployment](#deployment) · [Traction](#traction) · [Analytics](#event-instrumentation--core-funnel) · [Roadmap](#roadmap-async-gameplay--network-effects) · [Contributing](#contributing)

---

## Screenshots

<div align="center">
<table>
<tr>
<td align="center"><strong>Landing Page</strong></td>
<td align="center"><strong>Your Games</strong></td>
<td align="center"><strong>Forfeit Screen</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/landing.webp" alt="SkateHubba landing page — hero with 'Own The Spot' tagline" width="320"></td>
<td><img src="docs/screenshots/home-screen.webp" alt="Your Games dashboard showing active and completed matches" width="320"></td>
<td><img src="docs/screenshots/forfeit-screen.webp" alt="Forfeit screen with skull icon and rematch button" width="320"></td>
</tr>
</table>
</div>

---

## Tech Stack

| Layer     | Technology                                                   |
| --------- | ------------------------------------------------------------ |
| Frontend  | React 19, TypeScript 5.6, Vite 8                             |
| Styling   | Tailwind CSS 4 (dark theme, custom brand tokens)             |
| Auth      | Firebase Authentication (email/password + Google OAuth)      |
| Database  | Cloud Firestore (real-time, offline-capable)                 |
| Storage   | Firebase Storage (trick videos — WebM on web, MP4 on native) |
| Native    | Capacitor (iOS + Android)                                    |
| Hosting   | Vercel                                                       |
| Analytics | Vercel Analytics (cookie-free, GDPR-safe)                    |
| Errors    | Sentry                                                       |
| Testing   | Vitest, @testing-library/react, Playwright (E2E)             |
| CI        | GitHub Actions                                               |

No custom backend. No serverless functions. The client talks directly to Firebase with security enforced by Firestore rules.

---

## Features

### Gameplay

- **Async multiplayer** — players take turns on their own schedule, no live coordination needed
- **Video tricks** — one-take recording in-browser (WebM) or native app (MP4)
- **Real-time updates** — both players see state changes the moment they happen via Firestore snapshots
- **24-hour turn timer** — games don't stall; expired turns auto-forfeit
- **Optional referee** _(in review)_ — nominate a neutral third player to rule on disputes and "Call BS"

### Identity & Trust

- **Google OAuth + email auth** — popup sign-in with redirect fallback for mobile/Safari
- **Email verification** — required before play; resend from the app
- **Atomic username reservation** — no two players share a handle (Firestore transaction)
- **Block & report** — moderation tools backed by Firestore rules
- **Server-side game logic** — Firestore rules enforce turn order, scores, and rate limits — clients can't cheat

### Social & Discovery

- **Invite & share** — SMS, link copy, and native share for invites and trick clips
- **Push notifications** — FCM "your turn" alerts that deep-link into the game
- **Cross-game clips feed** — every landed trick rolls into a global, scrollable feed; the top slot autoplays muted with tap-to-unmute and rotates through visible clips
- **Clip upvotes** — single-tap, no-undo upvotes; one vote per user per clip enforced by rules _(vote-driven ranking in progress)_
- **Leaderboard** — ranked players by wins
- **Player profiles** — public per-user pages with full game history
- **Spots map** _(in progress)_ — geo-tagged skate spots with gnar rating + bust risk

### Platform

- **Native apps** — Capacitor builds for iOS and Android
- **PWA-ready** — installable from the browser
- **Offline support** — Firestore local cache lets you read games without internet
- **Cookie-free analytics** — Vercel Analytics with full funnel instrumentation (GDPR-safe)

---

## Quick Start

**Prerequisites:** Node ≥22 (`.nvmrc` pinned), npm 10+, a Firebase project with Auth + Firestore + Storage enabled.

```bash
git clone https://github.com/myhuemungusD/SkateHubba-play.git
cd SkateHubba-play
nvm use            # picks up Node 22 from .nvmrc
npm install
cp .env.example .env.local   # then fill in your Firebase config
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

For full setup including Firebase emulators, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Scripts

| Command                    | Description                                                   |
| -------------------------- | ------------------------------------------------------------- |
| `npm run dev`              | Start the Vite dev server at `http://localhost:5173`          |
| `npm run build`            | Type-check + production build → `dist/`                       |
| `npm run preview`          | Preview the production build locally                          |
| `npm test`                 | Run the unit + component test suite once                      |
| `npm run test:watch`       | Run tests in watch mode                                       |
| `npm run test:coverage`    | Run tests with coverage report (CI gate)                      |
| `npm run test:rules`       | Run Firestore security-rules tests against the rules emulator |
| `npm run test:e2e`         | Run Playwright E2E tests (auto-starts emulators)              |
| `npm run lint`             | Lint source files with ESLint                                 |
| `npm run lint:fix`         | Lint and auto-fix where possible                              |
| `npm run format`           | Format `src/**/*.{ts,tsx}` with Prettier                      |
| `npm run emulators`        | Start the Firebase emulator suite locally                     |
| `npm run cap:sync`         | Sync the web build into iOS/Android Capacitor projects        |
| `npm run cap:open:ios`     | Open the iOS project in Xcode                                 |
| `npm run cap:open:android` | Open the Android project in Android Studio                    |

---

## Project Structure

```
skatehubba-play/
├── public/                    # Static assets served at /
├── src/
│   ├── App.tsx                # Router + top-level providers (Auth/Game/Navigation)
│   ├── main.tsx               # React entry + Sentry init
│   ├── firebase.ts            # Firebase init (named database "skatehubba")
│   ├── index.css              # Tailwind v4 @theme + custom animations
│   ├── components/            # Reusable UI (VideoRecorder, Leaderboard, ClipsFeed, …)
│   │   └── map/               # Spots map UI (SpotMap, AddSpotSheet, BustRisk, …)
│   ├── screens/               # Full-page components (Lobby, GamePlay, MapPage, …)
│   ├── context/               # AuthContext, GameContext, NavigationContext, NotificationContext
│   ├── hooks/                 # useAuth, useOnlineStatus, usePlayerProfile, useBlockedUsers
│   ├── services/              # Single entry point for all Firebase calls
│   │   ├── auth.ts            #   sign up / sign in / Google OAuth / password reset
│   │   ├── users.ts           #   profiles + atomic username reservation
│   │   ├── games.ts           #   game CRUD + transactions + real-time subscriptions
│   │   ├── clips.ts           #   landed-trick clips feed + upvotes
│   │   ├── spots.ts           #   skate spots (geo-tagged map)
│   │   ├── storage.ts         #   video upload (WebM/MP4, 1KB–50MB, retry)
│   │   ├── notifications.ts   #   in-app + FCM push notifications
│   │   ├── blocking.ts        #   block / unblock users
│   │   ├── reports.ts         #   user + content reports
│   │   └── analytics.ts       #   Vercel Analytics event wrapper
│   ├── lib/                   # Third-party bridges (Sentry, Mapbox)
│   ├── utils/                 # Helpers, retry logic, error parsing
│   └── types/                 # Shared TypeScript types
├── e2e/                       # Playwright E2E tests (auth, game, map)
├── rules-tests/               # Firestore rules unit tests (clips, spots, notifications)
├── docs/                      # Documentation suite
│   └── screenshots/           # README images + brand assets
├── firestore.rules            # Firestore security rules (turn order, scores, rate limits)
├── storage.rules              # Storage security rules (auth, size, content-type)
├── .env.example               # Environment variable template
└── vercel.json                # CSP headers, HSTS, SPA rewrites, domain redirects
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values. The full template (with comments and source-of-truth links) lives in [`.env.example`](.env.example).

**Required**

| Variable                            | Source                                                          |
| ----------------------------------- | --------------------------------------------------------------- |
| `VITE_FIREBASE_API_KEY`             | Firebase Console → Project Settings → General → Your Apps       |
| `VITE_FIREBASE_AUTH_DOMAIN`         | "                                                               |
| `VITE_FIREBASE_PROJECT_ID`          | "                                                               |
| `VITE_FIREBASE_STORAGE_BUCKET`      | "                                                               |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | "                                                               |
| `VITE_FIREBASE_APP_ID`              | "                                                               |
| `VITE_MAPBOX_TOKEN`                 | Mapbox Dashboard → Access Tokens (required for the `/map` page) |

**Optional (recommended in production)**

| Variable                       | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `VITE_FIREBASE_MEASUREMENT_ID` | Firebase Analytics                                                           |
| `VITE_FIREBASE_VAPID_KEY`      | FCM web push (Firebase Console → Cloud Messaging → Web Push certificates)    |
| `VITE_RECAPTCHA_SITE_KEY`      | App Check via reCAPTCHA v3 (blocks bot/API-abuse traffic)                    |
| `VITE_SENTRY_DSN`              | Sentry error tracking; without it, errors only appear in the browser console |
| `VITE_APP_URL`                 | Production domain for Firebase email action links + invite URLs              |
| `VITE_MAPBOX_STYLE_URL`        | Custom Mapbox Studio style; falls back to `mapbox://styles/mapbox/dark-v11`  |
| `VITE_USE_EMULATORS=true`      | Local-only — point the client at the Firebase emulator suite                 |

---

## Documentation

| Document                                                 | Description                                 |
| -------------------------------------------------------- | ------------------------------------------- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)               | Local setup, emulators, dev workflow        |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                 | Production deploy to Vercel + Firebase      |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)             | System design, data flow, decisions         |
| [docs/DATABASE.md](docs/DATABASE.md)                     | Firestore schema and security rules         |
| [docs/API.md](docs/API.md)                               | Service layer function reference            |
| [docs/TESTING.md](docs/TESTING.md)                       | Test suite overview and how to run          |
| [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md)         | Game rules and turn flow                    |
| [docs/GAME_STATE_MACHINE.md](docs/GAME_STATE_MACHINE.md) | State transitions and lifecycle             |
| [docs/STATUS_REPORT.md](docs/STATUS_REPORT.md)           | Per-feature completion status               |
| [docs/DECISIONS.md](docs/DECISIONS.md)                   | Architecture decision records               |
| [CONTRIBUTING.md](CONTRIBUTING.md)                       | How to contribute                           |
| [SECURITY.md](SECURITY.md)                               | Security policy and vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md)                             | Version history                             |

---

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full guide. Short version:

1. Create a Firebase project with Auth, Firestore, and Storage enabled
2. Deploy the app to Vercel — import the repo, add env vars, deploy
3. Deploy security rules: `firebase deploy --only firestore:rules,storage`

---

## Traction

| Metric                | Status                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| Live at               | [skatehubba.com](https://skatehubba.com)                                 |
| Auth methods          | Email/password + Google OAuth (with verification + popup→redirect)       |
| Real-time multiplayer | Firestore `onSnapshot` — sub-second updates                              |
| Video infrastructure  | WebM (web) + MP4 (native), 1 KB – 50 MB per clip, retry w/ backoff       |
| Turn timer            | 24 h per turn, server-validated forfeit                                  |
| Native apps           | Capacitor builds for iOS + Android                                       |
| CI pipeline           | Lint → type-check → unit tests + coverage → build → Lighthouse → E2E     |
| Test coverage         | 100% on `src/services/**` and `src/hooks/**` (enforced by CI thresholds) |
| Rules tests           | `@firebase/rules-unit-testing` against the Firestore emulator            |
| Security posture      | App Check (reCAPTCHA v3), CSP/HSTS, Firestore rules enforce game logic   |
| Bundle size (gzip)    | ~289 kB total (Firebase 148 kB, app 71 kB) — code-split vendor chunks    |

---

## Event Instrumentation & Core Funnel

All analytics flow through a single wrapper (`src/services/analytics.ts`) backed by [Vercel Analytics](https://vercel.com/docs/analytics) — cookie-free, GDPR-safe, zero-config. Swapping providers is a one-file change.

### Instrumented Events

| Event                 | Fires When                                | Properties                    |
| --------------------- | ----------------------------------------- | ----------------------------- |
| `sign_up`             | New account created                       | `method` (email / google)     |
| `sign_in`             | User logs in                              | `method` (email / google)     |
| `game_created`        | Player creates a new challenge            | `gameId`                      |
| `trick_set`           | Setter records and submits a trick        | `gameId`, `trickName`         |
| `match_submitted`     | Matcher submits their attempt             | `gameId`, `landed` (bool)     |
| `game_completed`      | Game reaches a final state (win/loss)     | `gameId`, `won` (bool)        |
| `video_uploaded`      | Trick video successfully uploaded         | `durationMs`, `sizeBytes`     |
| `invite_sent`         | Player shares an invite link              | `method` (sms / copy / share) |
| `clip_shared`         | Player shares a trick clip                | `method`, `context`           |
| `clip_saved`          | Player saves a trick clip locally         | `context`                     |
| `game_shared`         | Player shares a completed game            | `context`, `method`           |
| `map_viewed`          | Spots map screen mounts                   | —                             |
| `spot_previewed`      | User taps a spot marker → preview opens   | `spotId`                      |
| `challenge_from_spot` | Challenge screen opened with `?spot=` ref | `spotId`                      |

### Core Funnel

```
sign_up → game_created → trick_set → match_submitted → game_completed
              ▲                              ↓
              │                       invite_sent (viral loop)
              │                              ↓
              │                       clip_shared (content flywheel)
              │
   map_viewed → spot_previewed → challenge_from_spot
                       (spot-driven acquisition path)
```

Each step maps 1:1 to a tracked event. Drop-off between any two stages is visible in the Vercel Analytics dashboard.

---

## Roadmap: Async Gameplay → Network Effects

For the live, evidence-backed completion table, see [docs/STATUS_REPORT.md](docs/STATUS_REPORT.md).

> **Legend:** ✅ shipped · 🚧 in progress · 🧑‍⚖️ in review · 🧊 deferred · ⏳ planned

### Phase 1 — Core Loop ✅ shipped

- Async S.K.A.T.E. gameplay with video proof
- Google OAuth + email auth with verification
- Real-time game state via Firestore snapshots
- 24-hour turn timer with auto-forfeit
- Player profiles with game history

### Phase 2 — Viral Mechanics ✅ shipped

- **Invite flow** — SMS/link/native share to pull friends in (instrumented: `invite_sent`)
- **Clip sharing** — share trick clips to social platforms (instrumented: `clip_shared`)
- **Rematch** — one-tap rematch at game over to keep engagement loops tight
- **Push notifications** — FCM "Your turn" alerts with deep-link into the game

### Phase 3 — Social Graph & Discovery 🟢 mostly shipped

- ✅ **Leaderboard** — ranked players by wins, creating aspirational targets
- ✅ **Player profiles** — public game archives that double as social proof
- ✅ **Challenge anyone** — search/invite by username, expanding beyond existing friend groups
- ✅ **Block & report** — moderation tooling backed by Firestore rules
- ✅ **Cross-game clips feed** — landed tricks become a discovery surface with an autoplaying top-slot that rotates through the visible clips
- ✅ **Clip upvotes** — single-tap, no-undo upvotes on every clip (per-vote rules + double-vote guard)
- 🚧 **Vote-driven clip ranking** — promote the feed from chronological to upvote-ranked (next up)
- 🧊 **Spectator mode** — deferred; revisit after vote-driven ranking lands

### Phase 4 — Network Effects Flywheel 🟡 in progress

- ✅ **Spot tagging** — geo-tagged skate spots with gnar rating + bust risk, full CRUD, Firestore rules, and security-rule tests
- ✅ **Spot map UI** — Mapbox GL integration with markers, filters (gnar/bust risk), spot preview cards, and add-spot sheet
- ✅ **Spot ↔ game linkage** — challenge from any spot detail page or map preview; `?spot=` query param flows through to the game doc
- ✅ **Bottom tab bar** — persistent Home / Map / Me navigation across all main screens
- 🚧 **Custom Mapbox style** — branded dark-base map style via Mapbox Studio ([#191](https://github.com/myhuemungusD/SkateHubba-play/issues/191))
- ⏳ **Crew challenges** — team-based S.K.A.T.E. (3v3) multiplies each invite by 6 players
- ⏳ **Trick library** — community trick index with video proof, a defensible content layer
- ⏳ **Tournaments** — bracket-style competitions for appointment engagement

### Unreleased — Referee System 🧑‍⚖️ in review

Optional third player who arbitrates disputes. See `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

- Nominate a referee at challenge time; honor system runs by default if declined or absent
- **Dispute path** — referee rules on a matcher's "landed" claim (24 h, then auto-accept)
- **Call BS path** — matcher can flag the setter's video before attempting (24 h, then set stands)
- New `setReview` phase + `judgeId` / `judgeStatus` / `judgeReviewFor` schema fields (internal names preserved to avoid a migration for in-flight games)
- Honor-system games skip the `disputable` phase entirely — landed swaps roles instantly

**The thesis:** Each game produces shareable video content. Each shared clip is a free acquisition channel. Each new player brings their crew. The game mechanic (asynchronous, video-first) removes the coordination cost that kills most multiplayer apps — you don't need to be online at the same time or at the same spot.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/logo-white.webp">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/logo-black.png">
  <img src="docs/screenshots/logo-black.png" alt="SkateHubba" width="80">
</picture>

**Built for skaters, by skaters.**

[skatehubba.com](https://skatehubba.com)

[MIT License](LICENSE)

</div>
