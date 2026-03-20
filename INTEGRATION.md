# Profile Integration Guide — SkateHubba-play

## File Placement

Copy these files into your existing `SkateHubba-play/src/` directory:

```
src/
├── types/
│   └── profile.ts                          ← NEW
├── lib/
│   └── profile-operations.ts               ← NEW (next to your existing firebase.ts)
├── components/
│   └── profile/
│       ├── ProfileStats.tsx                 ← NEW
│       └── ProfileGameHistory.tsx           ← NEW
├── screens/
│   └── ProfileScreen.tsx                    ← NEW
```

## Router Update

In your existing router file, add:

```tsx
import { ProfileScreen } from './screens/ProfileScreen';

// Inside your route config:
<Route path="/profile" element={<ProfileScreen />} />
<Route path="/profile/:username" element={<ProfileScreen />} />
```

## Firestore Rules

Merge the contents of `firestore-profile-rules.txt` into your existing
`firestore.rules` file. The `users` and `usernames` match blocks go inside
your existing `match /databases/{database}/documents` block.

Deploy:
```bash
firebase deploy --only firestore:rules
```

## Firestore Index

The game history query needs a composite index. Create it:

Collection: `games`
Fields: `participants` (Array), `status` (Ascending), `completedAt` (Descending)

Either add it to `firestore.indexes.json` or let Firebase auto-generate
the link when the query first runs in dev.

## Import Adjustments

The `profile-operations.ts` file imports from `./firebase`. Adjust that
path to match wherever your existing Firebase config/exports live:

```ts
import { db } from './firebase';       // ← adjust this path
import { storage } from './firebase';  // ← used in ProfileScreen for avatar upload
```

The `ProfileScreen.tsx` imports `useAuth` from `../../hooks/useAuth`.
Adjust to match your existing auth hook path.

## Game Resolution — Stats Update

Your existing game resolution logic (the Firestore transaction that
ends a game) needs to atomically update both players' stats. Add this
to that transaction:

```ts
// Inside your game resolution transaction, after determining winner/loser:
const winnerRef = doc(db, 'users', winnerUid);
const loserRef = doc(db, 'users', loserUid);

const winnerSnap = await txn.get(winnerRef);
const loserSnap = await txn.get(loserRef);

if (winnerSnap.exists()) {
  const ws = winnerSnap.data().stats;
  txn.update(winnerRef, {
    'stats.wins': ws.wins + 1,
    'stats.currentStreak': ws.currentStreak + 1,
    'stats.bestStreak': Math.max(ws.bestStreak, ws.currentStreak + 1),
  });
}

if (loserSnap.exists()) {
  const ls = loserSnap.data().stats;
  const field = isForfeit ? 'stats.forfeits' : 'stats.losses';
  txn.update(loserRef, {
    [field]: (isForfeit ? ls.forfeits : ls.losses) + 1,
    'stats.currentStreak': 0,
  });
}
```

This is critical — stats are computed on write, not on read.
No aggregation queries. Profile loads are always a single doc read.

## Testing Checklist

- [ ] Create profile for new user (first-time setup screen)
- [ ] Username uniqueness enforced (try duplicate)
- [ ] Edit own profile (display name, bio, username change)
- [ ] View opponent profile via /profile/:username
- [ ] Stats display correctly after completing a game
- [ ] Game history shows recent completed games
- [ ] Challenge button on opponent profile navigates correctly
- [ ] Avatar upload works (Firebase Storage)
- [ ] Loading and error states render (no blank screens)
