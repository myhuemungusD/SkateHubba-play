# Service Layer Reference

All Firebase operations are contained in `src/services/`. Components and hooks import from these files — never from the Firebase SDK directly. Services are pure async functions with no React dependencies, which makes them straightforward to mock in tests.

---

## Types

### `UserProfile` (`src/services/users.ts`)

```ts
interface UserProfile {
  uid: string; // Firebase Auth UID — matches Firestore document ID
  email: string; // From Firebase Auth at profile creation time
  username: string; // Normalized lowercase, 3–20 chars, [a-z0-9_]+
  stance: string; // "Regular" | "Goofy"
  createdAt: unknown; // Firestore serverTimestamp() — type widened intentionally
  emailVerified: boolean;
}
```

### `GameDoc` (`src/services/games.ts`)

```ts
interface GameDoc {
  id: string; // Firestore document ID
  player1Uid: string; // Challenger's UID
  player2Uid: string; // Opponent's UID
  player1Username: string; // Denormalized for display
  player2Username: string; // Denormalized for display
  player1IsVerifiedPro?: boolean; // Denormalized verified-pro status
  player2IsVerifiedPro?: boolean;
  p1Letters: number; // 0–5; 5 = spelled S.K.A.T.E. = loss
  p2Letters: number; // 0–5
  status: GameStatus; // "active" | "complete" | "forfeit"
  currentTurn: string; // UID of the player (or judge) who must act next
  phase: GamePhase; // "setting" | "matching" | "setReview" | "disputable"
  currentSetter: string; // UID of the current trick setter
  currentTrickName: string | null; // null during setting phase, set after setTrick()
  currentTrickVideoUrl: string | null; // Storage download URL, or null
  matchVideoUrl: string | null; // Matcher's video URL, or null
  turnDeadline: Timestamp; // 24h from last phase transition (rules cap at ≤48h)
  turnNumber: number; // Increments each time a full trick round completes
  winner: string | null; // UID of winner when status !== "active", else null
  turnHistory?: TurnRecord[]; // Append-only history (drives the clips feed)
  spotId?: string | null; // Optional skate spot id, immutable after create
  judgeId?: string | null; // Optional referee UID; null on honor-system games
  judgeUsername?: string | null;
  judgeStatus?: JudgeStatus; // null | "pending" | "accepted" | "declined"
  judgeReviewFor?: string | null; // UID under judge review (setReview/disputable)
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

type GameStatus = "active" | "complete" | "forfeit";
type GamePhase = "setting" | "matching" | "setReview" | "disputable";
type JudgeStatus = "pending" | "accepted" | "declined" | null;
```

> **Naming note:** The user-facing copy says "referee" everywhere but the schema keeps the `judge*` field names to avoid a Firestore migration for in-flight games.

---

## `src/services/auth.ts`

### `onAuthChange(cb)`

```ts
onAuthChange(cb: (user: User | null) => void): Unsubscribe
```

Subscribes to Firebase Auth state changes. Returns an unsubscribe function. Called once on mount in `useAuth`. Safe to call when Firebase is not initialized — immediately calls `cb(null)` and returns a no-op unsubscribe.

---

### `signUp(email, password)`

```ts
signUp(email: string, password: string): Promise<User>
```

Creates an email/password account. Fires a verification email as a side effect (fire-and-forget — does not affect the returned `User`).

**Throws:** Firebase Auth errors (`auth/email-already-in-use`, `auth/weak-password`, etc.)

---

### `signIn(email, password)`

```ts
signIn(email: string, password: string): Promise<User>
```

**Throws:** `auth/invalid-credential`, `auth/user-not-found`, `auth/too-many-requests`

---

### `signOut()`

```ts
signOut(): Promise<void>
```

---

### `resetPassword(email)`

```ts
resetPassword(email: string): Promise<void>
```

Sends a Firebase password-reset email. The reset link redirects to `VITE_APP_URL` (falls back to `window.location.origin`).

---

### `resendVerification()`

```ts
resendVerification(): Promise<void>
```

Sends a new verification email to the currently signed-in user. No-ops silently if there is no current user.

---

### `signInWithGoogle()`

```ts
signInWithGoogle(): Promise<User | null>
```

Attempts `signInWithPopup`. Returns the signed-in `User` on success. If the popup is blocked (`auth/popup-blocked`), initiates `signInWithRedirect` and returns `null` — the caller should wait for `onAuthStateChanged` to fire when the user returns from Google's OAuth page.

---

### `resolveGoogleRedirect()`

```ts
resolveGoogleRedirect(): Promise<User | null>
```

Must be called once on every app mount. Resolves any pending Google redirect sign-in. Returns the signed-in `User` if the user just returned from a Google redirect, or `null` if no redirect was in progress. Safe to call at any time.

---

## `src/services/users.ts`

### `getUserProfile(uid)`

```ts
getUserProfile(uid: string): Promise<UserProfile | null>
```

Returns the profile for the given UID, or `null` if no document exists.

---

### `isUsernameAvailable(username)`

```ts
isUsernameAvailable(username: string): Promise<boolean>
```

Normalizes the username (`toLowerCase().trim()`), validates format client-side, then checks `usernames/{normalized}` in Firestore. Returns `false` for invalid format or existing username.

---

### `createProfile(uid, email, username, stance, emailVerified?)`

```ts
createProfile(
  uid: string,
  email: string,
  username: string,
  stance: string,
  emailVerified?: boolean
): Promise<UserProfile>
```

Creates the user profile atomically using a Firestore transaction:

1. Reads `usernames/{normalized}` — aborts if it exists.
2. Writes `usernames/{normalized} = { uid, reservedAt }`.
3. Writes `users/{uid} = full profile`.

The username is normalized (`toLowerCase().trim()`) before storage.

**Throws:** `"Username is already taken"` if the reservation was lost to a race condition.

---

### `getUidByUsername(username)`

```ts
getUidByUsername(username: string): Promise<string | null>
```

Looks up `usernames/{normalized}` and returns the UID, or `null` if the username doesn't exist. Used by the challenge flow to resolve a username to a UID.

---

## `src/services/games.ts`

### `createGame(challengerUid, challengerUsername, opponentUid, opponentUsername)`

```ts
createGame(
  challengerUid: string,
  challengerUsername: string,
  opponentUid: string,
  opponentUsername: string
): Promise<string>
```

Creates a new game document. Returns the Firestore document ID.

Initial state: `phase: "setting"`, `currentTurn: challengerUid`, `currentSetter: challengerUid`, `turnNumber: 1`, `p1Letters: 0`, `p2Letters: 0`, `status: "active"`. Deadline set to 24 hours from now.

---

### `setTrick(gameId, trickName, videoUrl)`

```ts
setTrick(
  gameId: string,
  trickName: string,
  videoUrl: string | null
): Promise<void>
```

Submits the setter's trick. Sanitizes the trick name (trim + slice to 100 chars) at the service boundary. Runs a transaction to validate `phase === "setting"` and transition the game to `phase: "matching"`, switching `currentTurn` to the matcher.

**Throws:** `"Trick name cannot be empty"`, `"Game not found"`, `"Not in setting phase"`

---

### `submitMatchAttempt(gameId, matchVideoUrl, landed)`

```ts
submitMatchAttempt(
  gameId: string,
  matchVideoUrl: string | null,
  landed: boolean,
): Promise<{ gameOver: boolean; winner: string | null }>
```

Runs a transaction to record the match attempt. Letter assignment and next-phase logic depend on whether the game has an accepted judge (`judgeId != null && judgeStatus == "accepted"`):

| `landed` | Judge active? | Letter assigned          | Next state                                              |
| -------- | ------------- | ------------------------ | ------------------------------------------------------- |
| `true`   | no            | None                     | Roles swap immediately, `phase: "setting"`              |
| `true`   | yes           | None                     | `phase: "disputable"`, `currentTurn` flips to the judge |
| `false`  | either        | Matcher earns one letter | Same setter keeps setting, `phase: "setting"`           |

If either player reaches 5 letters, the transaction sets `status: "complete"` and `winner` to the opponent of the 5-letter player. Returns `{ gameOver: true, winner }`.

**Throws:** `"Please wait before submitting another action"` (client-side rate limit), `"Game not found"`, `"Game is already over"`, `"Not in matching phase"`

---

### `forfeitExpiredTurn(gameId)`

```ts
forfeitExpiredTurn(
  gameId: string
): Promise<{ forfeited: boolean; winner: string | null }>
```

Checks whether `turnDeadline` has passed and, if so, sets `status: "forfeit"` and `winner` to the opponent of `currentTurn`. Safe to call at any time — returns `{ forfeited: false, winner: null }` if the game is not active, already finished, or the deadline has not yet passed.

---

### `subscribeToMyGames(uid, onUpdate)`

```ts
subscribeToMyGames(
  uid: string,
  onUpdate: (games: GameDoc[]) => void
): Unsubscribe
```

Runs two parallel Firestore `onSnapshot` queries (`player1Uid == uid` and `player2Uid == uid`). Merges and deduplicates results by document ID. Sorts active games first, then by `turnNumber` descending. Returns a composite unsubscribe that cancels both listeners.

---

### `subscribeToGame(gameId, onUpdate)`

```ts
subscribeToGame(
  gameId: string,
  onUpdate: (game: GameDoc | null) => void
): Unsubscribe
```

Single-document `onSnapshot` listener. Calls `onUpdate(null)` if the document doesn't exist or if the listener errors.

---

## `src/services/storage.ts`

### `uploadVideo(gameId, turnNumber, role, blob, onProgress?, maxRetries?)`

```ts
uploadVideo(
  gameId: string,
  turnNumber: number,
  role: "set" | "match",
  blob: Blob,
  onProgress?: (progress: UploadProgress) => void,
  maxRetries?: number, // defaults to 2
): Promise<string>
```

Uploads a video blob to Firebase Storage at `games/{gameId}/turn-{turnNumber}/{role}.{webm|mp4}`. The extension is derived from the blob's MIME type — `video/mp4` for native (Capacitor) recordings and `video/webm` for web (MediaRecorder). Content-Type is set to match. Pre-validates 1 KB ≤ size ≤ 50 MB before any network call. Uses `uploadBytesResumable` for progress tracking and retries with exponential backoff (1 s, 2 s) on transient failures. Returns the Firebase Storage download URL.

Custom metadata stored per upload: `uploaderUid` (required by storage rules for ownership enforcement), `gameId`, `turn` (string), `role`, `uploadedAt` (ISO 8601), `retainUntil` (90-day lifecycle hint).

---

## `src/hooks/useAuth.ts`

### `useAuth()`

```ts
useAuth(): {
  loading: boolean;
  user: User | null;
  profile: UserProfile | null;
  refreshProfile: () => Promise<void>;
}
```

React hook that wraps `onAuthChange` and Firestore profile fetching.

| Property           | Description                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| `loading`          | `true` until the first `onAuthStateChanged` event fires                    |
| `user`             | Firebase `User` object, or `null` if not signed in                         |
| `profile`          | Firestore `UserProfile`, or `null` if not loaded or not created yet        |
| `refreshProfile()` | Re-fetches the profile for the current user — call after `createProfile()` |

**Implementation note:** `refreshProfile` uses a `useRef` to track the current user, avoiding stale closure issues that would occur if it captured `user` from state at the time the callback was created.
