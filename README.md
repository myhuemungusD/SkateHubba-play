# SkateHubba™ S.K.A.T.E. Game — Deployable MVP

A clean, standalone async S.K.A.T.E. trick battle game. No Express backend, no PostgreSQL, no path alias issues. Just React + Vite + Firebase — ships in 15 minutes.

## Architecture

```
React + Vite (SPA)          ←  Frontend
Firebase Auth               ←  Email signup/signin/verify/reset
Firestore                   ←  Users, usernames, games (real-time)
Firebase Storage             ←  One-take trick videos
Vercel                       ←  Hosting (skatehubba.com or subdomain)
```

Zero serverless functions. Zero custom API layer. The client talks directly to Firebase with Firestore security rules enforcing all access control.

## What's Built

**Complete game loop:**
1. Sign up / sign in (email + password)
2. Create profile (unique username + stance)
3. Challenge an opponent by username
4. Set a trick (name it, record one-take video, submit)
5. Opponent matches (watches your video, records their attempt, self-judges)
6. Missed trick = earn a letter (S → K → A → T → E)
7. First to spell S.K.A.T.E. loses
8. Rematch

**Production features:**
- Firebase Auth with email verification
- Atomic username reservation (Firestore transaction)
- Real-time game updates (both players see changes instantly)
- 24-hour turn timer
- One-take video recording (MediaRecorder API)
- Video upload to Firebase Storage
- Firestore security rules (players can only modify their own games)
- Offline persistence (Firestore local cache)
- "Coming Soon" roadmap section

---

## Deploy in 15 Minutes

### Step 1: Firebase Setup (5 min)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Open your existing **Skatehubba** project (or create one)
3. Enable these services:

**Authentication:**
- Go to Authentication → Sign-in method
- Enable **Email/Password**
- Go to Settings → Authorized domains
- Add: `skatehubba.com`, `www.skatehubba.com`, and your Vercel preview domain

**Firestore Database:**
- Go to Firestore Database
- Create database (production mode)
- Start in **nam5 (us-central)** or your preferred region

**Storage:**
- Go to Storage
- Set up (production mode)

4. Get your Firebase config:
- Go to Project Settings → General → Your Apps
- If no web app exists, click "Add app" → Web → register it
- Copy the `firebaseConfig` object values

### Step 2: Create New GitHub Repo (2 min)

```bash
# Extract the project
tar xzf skatehubba-play.tar.gz -C skatehubba-play
cd skatehubba-play

# Initialize git
git init
git add -A
git commit -m "feat: skatehubba async s.k.a.t.e. game mvp"

# Create repo on GitHub (name it skatehubba-play or whatever you want)
# Then push:
git remote add origin https://github.com/myhuemungusD/skatehubba-play.git
git branch -M main
git push -u origin main
```

### Step 3: Deploy to Vercel (5 min)

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the `skatehubba-play` repo
3. Framework: **Vite** (auto-detected)
4. Add environment variables — paste your Firebase config values:

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=sk8hub-d7806.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=sk8hub-d7806
VITE_FIREBASE_STORAGE_BUCKET=sk8hub-d7806.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

5. Click **Deploy**

### Step 4: Deploy Firestore Rules (3 min)

```bash
# Install Firebase CLI if you don't have it
npm install -g firebase-tools

# Login
firebase login

# Set your project
firebase use sk8hub-d7806

# Deploy security rules
firebase deploy --only firestore:rules,storage
```

### Step 5: Assign Domain (optional)

If you want this on `skate.skatehubba.com` or a subdomain:
- Vercel → Project Settings → Domains → Add `skate.skatehubba.com`
- Add the CNAME record in your DNS
- Add the domain to Firebase Auth → Authorized domains

---

## File Structure

```
skatehubba-play/
├── index.html              # Entry point
├── package.json            # Dependencies (React, Firebase, Vite)
├── vercel.json             # Vercel SPA routing
├── firebase.json           # Firebase rules config
├── firestore.rules         # Firestore security rules
├── storage.rules           # Storage security rules
├── tailwind.config.js      # SkateHubba brand tokens
├── vite.config.ts
├── tsconfig.json
├── .env.example            # Environment variable template
└── src/
    ├── main.tsx            # React entry
    ├── App.tsx             # All screens + state machine
    ├── firebase.ts         # Firebase init
    ├── index.css           # Tailwind + animations
    ├── vite-env.d.ts       # Type declarations
    ├── hooks/
    │   └── useAuth.ts      # Auth state management
    └── services/
        ├── auth.ts         # Signup/signin/reset/verify
        ├── users.ts        # Profile + username reservation
        ├── games.ts        # Game CRUD + real-time subscriptions
        └── storage.ts      # Video upload
```

## Firestore Collections

```
users/{uid}
  ├── uid: string
  ├── email: string
  ├── username: string
  ├── stance: string
  ├── createdAt: timestamp
  └── emailVerified: boolean

usernames/{username}
  ├── uid: string
  └── reservedAt: timestamp

games/{gameId}
  ├── player1Uid: string
  ├── player2Uid: string
  ├── player1Username: string
  ├── player2Username: string
  ├── p1Letters: number (0-5)
  ├── p2Letters: number (0-5)
  ├── status: "active" | "complete" | "forfeit"
  ├── currentTurn: string (uid)
  ├── phase: "setting" | "matching"
  ├── currentSetter: string (uid)
  ├── currentTrickName: string | null
  ├── currentTrickVideoUrl: string | null
  ├── matchVideoUrl: string | null
  ├── turnDeadline: timestamp
  ├── turnNumber: number
  ├── winner: string | null (uid)
  ├── createdAt: timestamp
  └── updatedAt: timestamp
```

## What's NOT in this MVP (by design)

- No Express backend
- No PostgreSQL / Neon / Drizzle
- No path aliases (@shared/*)
- No serverless functions
- No payments / subscriptions
- No spot map
- No AR / streaming / bounties / shop

These stay as "Coming Soon" placeholders in the lobby.

## Local Development

```bash
npm install
cp .env.example .env
# Fill in your Firebase config in .env
npm run dev
```

Opens at http://localhost:5173
