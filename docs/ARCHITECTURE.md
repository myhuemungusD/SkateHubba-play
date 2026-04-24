# Architecture

## Overview

SkateHubba S.K.A.T.E. is a zero-backend web application. There is no Express server, no REST API, and no serverless functions. The React SPA talks directly to Firebase services, with Firestore security rules serving as the sole authorization layer.

This means:

- **Client code is not trusted.** Any business logic in the browser is for UX only. The Firestore rules enforce the same constraints server-side and will reject invalid writes regardless of what the client does.
- **The attack surface is small.** Firebase and Vercel handle infrastructure security. There's no custom server to harden.
- **Operational cost is near-zero at low scale.** No servers to run or pay for beyond Firebase's free tier.

---

## Technology Choices

### React 19 + TypeScript + Vite 8

- SPA only — no SSR. Routing is handled by `react-router-dom` v7. All `<Route>` declarations live in `App.tsx`; navigation goes through `NavigationContext.setScreen` (or `useNavigate` for parameterised routes like `/player/:uid` and `/spots/:id`).
- Non-critical screens — gameplay, profile, map, settings, legal pages, NotFound — are imported via `lazy()` and rendered inside a single top-level `<Suspense>`. Landing, AuthScreen, ProfileSetup, and Lobby are eager so first paint never has to wait on a chunk fetch.
- Code splitting is driven by those `lazy()` imports plus Vite's automatic vendor chunking; no manual `manualChunks` config is required.
- `import.meta.env.VERCEL` is injected via `vite.config.ts` so the app can detect a missing Firebase config in a Vercel context and show a helpful error message.

### Firebase Auth

- Email/password with mandatory email verification before gameplay.
- Google OAuth via popup, with automatic redirect fallback when popups are blocked (common on mobile browsers and Safari). The redirect flow requires `resolveGoogleRedirect()` to be called on every app mount.
- `select_account` prompt always shown for Google — prevents silent session fixation when a user shares a device.

### Cloud Firestore

- Named database `"skatehubba"` (not the default Firestore database). This is set as the third argument to `initializeFirestore()`. **This affects the Firebase CLI**: deploy commands must target this named database explicitly.
- Offline persistence is enabled via `persistentLocalCache` + `persistentMultipleTabManager`, which means reads work without a network connection and writes queue and flush on reconnect.
- No compound queries — all game queries use single-field equality filters (`player1Uid == uid`, `player2Uid == uid`) which are indexed automatically by Firestore.

### Firebase Storage

- Used exclusively for trick videos. Web (MediaRecorder) emits WebM; native (Capacitor) emits MP4.
- Storage rules enforce authentication, file size (1 KB – 50 MB), content type (`video/webm` or `video/mp4`), and an exact filename allowlist (`set.webm`, `set.mp4`, `match.webm`, `match.mp4`). The uploader's UID is bound into `customMetadata.uploaderUid` at upload time so update/delete can verify ownership. Storage rules cannot cross-reference Firestore, so game membership is not verified at the storage layer — see [SECURITY.md](../SECURITY.md) for implications.

### Vercel

- Framework set to `vite`. Build output is `dist/`. All paths rewrite to `index.html` for SPA navigation.
- `X-Robots-Tag: noindex, nofollow` is injected on all non-production hosts (any host that is not `skatehubba.com`) via `vercel.json`. This prevents Vercel preview deployment URLs from appearing in search engines.
- 301 redirects are configured for `skatehubba.xyz`, `www.skatehubba.xyz`, and `www.skatehubba.com` → `skatehubba.com` to complete the domain migration and preserve SEO equity.
- No Vercel serverless functions are used.

---

## Application State Machine

`App.tsx` manages screen state through `react-router-dom` `<Route>` declarations plus `NavigationContext`. Each route renders a screen; auth/profile state gates which routes are reachable.

### Route map

```
/               Landing
/auth           AuthScreen           (sign-up / sign-in / Google OAuth, inline DOB age gate)
/profile        ProfileSetup         (post-Google fallback for username + stance)
/lobby          Lobby                (primary signed-in destination)
/challenge      ChallengeScreen
/game           GamePlayScreen       (active game)
/gameover       GameOverScreen       (complete or forfeit)
/record         PlayerProfileScreen  (own profile shortcut)
/player/:uid    PlayerProfileScreen  (any user)
/map            MapPage              (skate spots — Mapbox)
/spots/:id      SpotDetailPage
/settings       Settings
/privacy        PrivacyPolicy
/terms          TermsOfService
/data-deletion  DataDeletion
/feed           → redirects to /lobby (clips feed is now embedded in Lobby)
/404, *         NotFound
```

### Auth guard pattern

`App.tsx` evaluates conditions in this order before rendering any screen:

1. `!firebaseReady` → renders a "Firebase not configured" error screen with environment-specific instructions.
2. `loading` (from `useAuthContext`) → renders a loading spinner.
3. Route-level guards: each protected route checks `auth.activeProfile` (and `auth.user.emailVerified` where required). Failures `<Navigate>` to `/` or `/lobby` as appropriate.
4. The catch-all `*` route redirects unknown paths to `/404`.

---

## Firebase Initialization (`src/firebase.ts`)

Firebase is initialized conditionally. If `VITE_FIREBASE_API_KEY` is not set, all Firebase service exports are `null` and a `firebaseReady = false` flag is exported.

Service helper functions (`requireDb()`, `requireAuth()`, `requireStorage()`) throw a descriptive error if called before initialization. This prevents silent failures where code attempts to use an uninitialized Firebase service.

**Emulator support:** When `VITE_USE_EMULATORS=true` and Vite is in dev mode, all three services are connected to localhost emulators (Auth `:9099`, Firestore `:8080`, Storage `:9199`). Both conditions must be true — emulators cannot be enabled in a production build.

---

## Service Layer

All Firebase SDK calls live in `src/services/`. Components and hooks import from services — never from the Firebase SDK directly. This keeps Firebase logic testable (services are easily mocked) and keeps `App.tsx` readable.

| File                            | Responsibility                                                               |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `src/services/auth.ts`          | Sign up, sign in, sign out, Google OAuth, password reset, email verification |
| `src/services/users.ts`         | User profile CRUD, atomic username reservation, verified-pro lookup          |
| `src/services/userData.ts`      | Account-deletion cascade + GDPR data export                                  |
| `src/services/games.ts`         | Game creation, turn actions (transactions), real-time subscriptions          |
| `src/services/clips.ts`         | Landed-trick clips feed + upvotes                                            |
| `src/services/spots.ts`         | Geo-tagged skate spot CRUD + comments                                        |
| `src/services/storage.ts`       | Video upload (WebM web / MP4 native) with retry + progress                   |
| `src/services/notifications.ts` | In-app notification writes + subscriptions                                   |
| `src/services/fcm.ts`           | FCM token registration + service-worker wiring                               |
| `src/services/nudge.ts`         | Push-notification "your turn" nudges                                         |
| `src/services/blocking.ts`      | Block / unblock users                                                        |
| `src/services/reports.ts`       | UGC content + player reports                                                 |
| `src/services/analytics.ts`     | Vercel Analytics + PostHog event wrapper                                     |
| `src/services/logger.ts`        | Structured log + metrics emitter                                             |
| `src/hooks/useAuth.ts`          | React hook that wraps `onAuthStateChanged` + profile fetch                   |

### Why all write operations use transactions

Game state transitions (`setTrick`, `submitMatchResult`, `forfeitExpiredTurn`) use `runTransaction`. This ensures that the read-then-write sequence is atomic — if another client modifies the document between the read and the write, Firestore will retry the transaction. Without transactions, two simultaneous actions (e.g., one player submits a trick while the opponent's client triggers a forfeit) could produce inconsistent state.

### `subscribeToMyGames` — dual query merge

Firestore does not support OR queries across different fields in a single query. To find all games where a user is either `player1Uid` or `player2Uid`, two parallel `onSnapshot` queries run. Their results are merged in memory, deduplicated by document ID, and sorted (active games first, then by `turnNumber` descending). Both listeners share a single unsubscribe function returned to the caller.

---

## Real-Time Data Flow

```
Firestore (server)
    │
    ├─ onSnapshot (games/{gameId})          ← subscribeToGame
    │       │
    │       └─ App.tsx game state → gameplay screen re-renders
    │
    └─ onSnapshot (games where player=uid)  ← subscribeToMyGames (×2 queries)
            │
            └─ merged + sorted → lobby screen re-renders
```

Both listeners call their callbacks synchronously when cached data is available (Firestore offline persistence), and again when the server confirms or updates the data.

Unsubscribe functions are returned from both subscription helpers and called in `useEffect` cleanup to prevent memory leaks and stale updates after navigation.

---

## Authentication Flow Details

### Email/password

1. `signUp(email, password)` → creates the Firebase Auth account and fires a verification email (fire-and-forget — the UI does not wait for this).
2. Until email is verified, an in-app banner is shown. The user can still navigate the app but cannot interact with game features until verified.
3. `signIn(email, password)` → logs in. The Auth SDK handles token refresh automatically.

### Google OAuth

1. `signInWithGoogle()` attempts `signInWithPopup`. On success, returns the `User` immediately.
2. If the popup is blocked (`auth/popup-blocked`), it falls back to `signInWithRedirect`, which navigates the browser to Google's OAuth page. The function returns `null` to signal that a redirect was initiated.
3. On every app mount, `resolveGoogleRedirect()` calls `getRedirectResult()`. If the user just returned from a Google redirect, this resolves the sign-in and `onAuthStateChanged` fires normally.

---

## Security Model

See [SECURITY.md](../SECURITY.md) for the full security policy.

**Summary:** Firestore rules are the authority. Client-side validation mirrors the rules for UX purposes but provides no security guarantee. Any direct Firestore write that violates the rules — whether from the app or from the browser console — will be rejected with a `permission-denied` error.
