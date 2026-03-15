/**
 * Firebase Emulator REST API helpers for E2E test setup and teardown.
 *
 * The Firebase Emulators expose management endpoints that let tests:
 *  - Clear all auth users and Firestore documents between tests
 *  - Create users and profiles programmatically (faster than going through the UI)
 *  - Verify emails without a real inbox
 *  - Write arbitrary Firestore documents for timeout / game-over scenarios
 */

const PROJECT_ID = "demo-skatehubba";
const DB_NAME = "skatehubba";
const API_KEY = "demo-key";

const AUTH = `http://localhost:9099`;
const FS = `http://localhost:8080`;

// ─── Clearing state ──────────────────────────────────────────────────────────

/** Delete every user from the Auth emulator. */
export async function clearAuth(): Promise<void> {
  const res = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`clearAuth failed: ${res.status} ${await res.text()}`);
}

/** Delete every document from the named Firestore database. */
export async function clearFirestore(): Promise<void> {
  const res = await fetch(`${FS}/emulator/v1/projects/${PROJECT_ID}/databases/${DB_NAME}/documents`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`clearFirestore failed: ${res.status} ${await res.text()}`);
}

/** Wipe Auth + Firestore — call in beforeEach to guarantee test isolation. */
export async function clearAll(): Promise<void> {
  await Promise.all([clearAuth(), clearFirestore()]);
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

interface CreatedUser {
  uid: string;
  idToken: string;
  email: string;
}

/**
 * Create a Firebase Auth user directly via the emulator's Identity Toolkit endpoint.
 * Returns the UID and idToken so callers can make authenticated Firestore writes.
 */
export async function createUser(email: string, password: string): Promise<CreatedUser> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`createUser failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { localId: string; idToken: string; email: string };
  return { uid: data.localId, idToken: data.idToken, email: data.email };
}

/**
 * Mark a user's email as verified by:
 *  1. Fetching the pending OOB code from the Auth emulator.
 *  2. Applying it via the Identity Toolkit `setAccountInfo` endpoint.
 *
 * After calling this the Auth emulator has emailVerified=true for the user.
 * The browser page must still call `page.reload()` so the Firebase SDK picks up
 * the change via onAuthStateChanged.
 */
export async function verifyEmail(email: string): Promise<void> {
  // 1. Retrieve pending OOB codes
  const codesRes = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  if (!codesRes.ok) throw new Error(`getOobCodes failed: ${codesRes.status}`);
  const { oobCodes = [] } = (await codesRes.json()) as {
    oobCodes?: Array<{ email: string; oobCode: string; requestType: string }>;
  };

  const entry = oobCodes.find((c) => c.email === email && c.requestType === "VERIFY_EMAIL");
  if (!entry) throw new Error(`No VERIFY_EMAIL OOB code found for ${email}`);

  // 2. Apply the OOB code to mark emailVerified=true in the emulator
  const applyRes = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oobCode: entry.oobCode }),
  });
  if (!applyRes.ok) throw new Error(`verifyEmail failed: ${applyRes.status} ${await applyRes.text()}`);
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { mapValue: { fields: Record<string, FsValue> } };

function toFsValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, toFsValue(val)])),
      },
    };
  }
  return { stringValue: String(v) };
}

/** Write (create-or-overwrite) a Firestore document via the emulator REST API. */
export async function writeDoc(collection: string, docId: string, data: Record<string, unknown>): Promise<void> {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFsValue(v)]));
  const url = `${FS}/v1/projects/${PROJECT_ID}/databases/${DB_NAME}/documents/${collection}/${docId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`writeDoc ${collection}/${docId} failed: ${res.status} ${await res.text()}`);
}

/**
 * Create a Firestore user profile (writes both `users/{uid}` and `usernames/{username}`).
 * Use this to set up the second player without going through the UI.
 */
export async function createProfile(
  uid: string,
  username: string,
  email: string,
  emailVerified = false,
): Promise<void> {
  await Promise.all([
    writeDoc("users", uid, { uid, username, email, stance: "Regular", emailVerified }),
    writeDoc("usernames", username.toLowerCase(), { uid }),
  ]);
}

/**
 * Write a game document directly to Firestore.
 * `overrides` can patch any field — e.g. `{ turnDeadline: new Date(0) }` for timeout tests.
 */
export async function createGame(
  gameId: string,
  p1Uid: string,
  p1Username: string,
  p2Uid: string,
  p2Username: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await writeDoc("games", gameId, {
    player1Uid: p1Uid,
    player2Uid: p2Uid,
    player1Username: p1Username,
    player2Username: p2Username,
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    phase: "setting",
    currentTurn: p1Uid,
    currentSetter: p1Uid,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: deadline,
    turnNumber: 1,
    winner: null,
    ...overrides,
  });
}

/**
 * Patch the `turnDeadline` of an existing game to a timestamp in the past
 * so that the forfeit check in GamePlayScreen triggers immediately.
 */
export async function expireGameDeadline(gameId: string): Promise<void> {
  // One hour in the past — clearly expired
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const url =
    `${FS}/v1/projects/${PROJECT_ID}/databases/${DB_NAME}/documents/games/${gameId}` +
    `?updateMask.fieldPaths=turnDeadline`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { turnDeadline: { timestampValue: past.toISOString() } } }),
  });
  if (!res.ok) throw new Error(`expireGameDeadline failed: ${res.status} ${await res.text()}`);
}
