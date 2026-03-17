<div align="center">

<img src="public/logoblack.png" alt="SkateHubba Logo" width="200">

# SkateHubba S.K.A.T.E.

**Own the spot. Play S.K.A.T.E. anywhere.**

An async multiplayer trick battle game for skateboarders. Challenge friends, set tricks on video, and see if they can match you — one letter at a time.

[![Live](https://img.shields.io/badge/Play_Now-skatehubba.com-FF6B00?style=for-the-badge&logo=firebase&logoColor=white)](https://skatehubba.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=for-the-badge)](LICENSE)

<br>

<img src="public/shgrafittibackground.png" alt="SkateHubba - Graffiti Branding" width="600">

</div>

---

## What is S.K.A.T.E.?

S.K.A.T.E. is the skateboarding version of HORSE. One player sets a trick; the other must land it. Miss and you earn a letter — **S**, then **K**, then **A**, then **T**, then **E**. First to spell it out loses.

This app brings that to your phone, async. Set your trick whenever, opponent matches whenever. No need to be at the same spot or online at the same time.

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
<td><img src="public/landing.png" alt="Landing Page" width="320"></td>
<td><img src="public/Homescreenscreenshot.png" alt="Home Screen - Your Games" width="320"></td>
<td><img src="public/forfiettime.png" alt="Forfeit Screen" width="320"></td>
</tr>
</table>
</div>

---

## Tech Stack

| Layer    | Technology                                              |
| -------- | ------------------------------------------------------- |
| Frontend | React 18, TypeScript, Vite                              |
| Styling  | Tailwind CSS (dark theme, custom brand tokens)          |
| Auth     | Firebase Authentication (email/password + Google OAuth) |
| Database | Cloud Firestore (real-time, offline-capable)            |
| Storage  | Firebase Storage (trick videos in WebM)                 |
| Hosting  | Vercel                                                  |
| Testing  | Vitest, @testing-library/react                          |
| CI       | GitHub Actions                                          |

No custom backend. No serverless functions. The client talks directly to Firebase with security enforced by Firestore rules.

---

## Features

- **Async gameplay** — players take turns on their own schedule
- **Video tricks** — record one-take WebM videos in-browser
- **Real-time updates** — both players see game state the moment it changes
- **24-hour turn timer** — games don't stall; expired turns auto-forfeit
- **Google OAuth** — popup sign-in with redirect fallback for mobile/Safari
- **Email verification** — required before play; resend from the app
- **Atomic username reservation** — no two players share a handle (Firestore transaction)
- **Offline support** — Firestore local cache lets you read games without internet
- **PWA-ready** — installable on iOS and Android
- **Security rules** — all game logic validated server-side; client can't cheat scores

---

## Documentation

| Document                                         | Description                                 |
| ------------------------------------------------ | ------------------------------------------- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)       | Local setup, emulators, dev workflow        |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)         | Production deploy to Vercel + Firebase      |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | System design, data flow, decisions         |
| [docs/DATABASE.md](docs/DATABASE.md)             | Firestore schema and security rules         |
| [docs/API.md](docs/API.md)                       | Service layer function reference            |
| [docs/TESTING.md](docs/TESTING.md)               | Test suite overview and how to run          |
| [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md) | Game rules and turn flow                    |
| [CONTRIBUTING.md](CONTRIBUTING.md)               | How to contribute                           |
| [SECURITY.md](SECURITY.md)                       | Security policy and vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md)                     | Version history                             |

---

## Quick Start

```bash
git clone https://github.com/myhuemungusD/skatehubba-play.git
cd skatehubba-play
npm install
cp .env.example .env.local
# Fill in your Firebase config values in .env.local
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

For full setup instructions including Firebase emulators, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Project Structure

```
skatehubba-play/
├── src/
│   ├── App.tsx              # All screens + state machine (~1700 lines)
│   ├── firebase.ts          # Firebase initialization
│   ├── main.tsx             # React entry point
│   ├── index.css            # Tailwind + custom animations
│   ├── hooks/
│   │   └── useAuth.ts       # Auth state + profile hook
│   ├── services/
│   │   ├── auth.ts          # Sign up, sign in, Google OAuth, password reset
│   │   ├── users.ts         # Profiles + atomic username reservation
│   │   ├── games.ts         # Game CRUD + real-time subscriptions
│   │   └── storage.ts       # Video upload to Firebase Storage
│   └── __tests__/
│       └── smoke-e2e.test.tsx  # 45+ end-to-end smoke tests
├── firestore.rules          # Firestore security rules
├── storage.rules            # Storage security rules
├── vercel.json              # Vercel SPA config
├── firebase.json            # Firebase CLI config
├── .env.example             # Environment variable template
└── docs/                    # Full documentation suite
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values from your Firebase project:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=   # optional, for Analytics

VITE_USE_EMULATORS=true         # optional, enable local emulators
VITE_APP_URL=https://...        # optional, for email action link redirects
```

---

## Scripts

```bash
npm run dev        # Start dev server at localhost:5173
npm run build      # Type check + production build → dist/
npm run preview    # Preview the production build locally
npm test           # Run test suite once
npm run test:watch # Run tests in watch mode
```

---

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full guide. Short version:

1. Create a Firebase project with Auth, Firestore, and Storage enabled
2. Deploy the app to Vercel — import the repo, add env vars, deploy
3. Deploy security rules: `firebase deploy --only firestore:rules,storage`

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

<img src="public/SHwhitelogo.png" alt="SkateHubba" width="80">

**Built for skaters, by skaters.**

[skatehubba.com](https://skatehubba.com)

</div>

## License

MIT
