/**
 * SkateHubba™ Profile Operations
 * All Firestore reads/writes for user profiles.
 * Username uniqueness enforced via transactional writes to `usernames` collection.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase'; // your existing firebase config export
import type {
  UserProfile,
  ProfileEditPayload,
  UsernameValidation,
  GameSummary,
  PlayerStats,
} from '../types/profile';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USERS = 'users';
const USERNAMES = 'usernames';
const GAMES = 'games';
const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,19}$/;
const BIO_MAX_LENGTH = 150;
const GAME_HISTORY_LIMIT = 10;

// ---------------------------------------------------------------------------
// Username validation
// ---------------------------------------------------------------------------

export function validateUsername(raw: string): UsernameValidation {
  const username = raw.trim().toLowerCase();

  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (username.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or fewer' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      error: 'Letters, numbers, dots, hyphens, underscores only. Must start with a letter or number.',
    };
  }
  return { valid: true, error: null };
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const ref = doc(db, USERNAMES, username.toLowerCase());
  const snap = await getDoc(ref);
  return snap.exists();
}

// ---------------------------------------------------------------------------
// Profile creation (first-time setup after auth)
// ---------------------------------------------------------------------------

export async function createProfile(
  uid: string,
  payload: ProfileEditPayload
): Promise<void> {
  const username = payload.username.trim().toLowerCase();

  await runTransaction(db, async (txn) => {
    // Check username is not taken
    const usernameRef = doc(db, USERNAMES, username);
    const usernameSnap = await txn.get(usernameRef);

    if (usernameSnap.exists()) {
      throw new Error('Username is already taken');
    }

    const userRef = doc(db, USERS, uid);

    const profile: Omit<UserProfile, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
      uid,
      displayName: payload.displayName.trim(),
      username,
      photoURL: payload.photoURL,
      bio: payload.bio.trim().slice(0, BIO_MAX_LENGTH),
      stats: {
        wins: 0,
        losses: 0,
        forfeits: 0,
        currentStreak: 0,
        bestStreak: 0,
      },
      createdAt: serverTimestamp(),
    };

    // Atomic: claim username + create profile
    txn.set(usernameRef, { uid });
    txn.set(userRef, profile);
  });
}

// ---------------------------------------------------------------------------
// Profile reads
// ---------------------------------------------------------------------------

export async function getProfileByUid(uid: string): Promise<UserProfile | null> {
  const ref = doc(db, USERS, uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

export async function getProfileByUsername(username: string): Promise<UserProfile | null> {
  const usernameRef = doc(db, USERNAMES, username.toLowerCase());
  const usernameSnap = await getDoc(usernameRef);
  if (!usernameSnap.exists()) return null;

  const { uid } = usernameSnap.data() as { uid: string };
  return getProfileByUid(uid);
}

/** Real-time listener for own profile (stats update live after game ends) */
export function subscribeToProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const ref = doc(db, USERS, uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(snap.data() as UserProfile);
    },
    onError
  );
}

// ---------------------------------------------------------------------------
// Profile updates
// ---------------------------------------------------------------------------

export async function updateProfile(
  uid: string,
  currentUsername: string,
  payload: Partial<ProfileEditPayload>
): Promise<void> {
  const newUsername = payload.username?.trim().toLowerCase();
  const usernameChanged = newUsername && newUsername !== currentUsername;

  if (usernameChanged) {
    // Username change requires a transaction to release old + claim new
    await runTransaction(db, async (txn) => {
      const newUsernameRef = doc(db, USERNAMES, newUsername);
      const newUsernameSnap = await txn.get(newUsernameRef);

      if (newUsernameSnap.exists()) {
        throw new Error('Username is already taken');
      }

      const oldUsernameRef = doc(db, USERNAMES, currentUsername);
      const userRef = doc(db, USERS, uid);

      // Release old username, claim new, update profile
      txn.delete(oldUsernameRef);
      txn.set(newUsernameRef, { uid });
      txn.update(userRef, buildUpdatePayload(payload));
    });
  } else {
    // Simple update, no transaction needed
    const userRef = doc(db, USERS, uid);
    await updateDoc(userRef, buildUpdatePayload(payload));
  }
}

function buildUpdatePayload(
  payload: Partial<ProfileEditPayload>
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (payload.displayName !== undefined) {
    updates.displayName = payload.displayName.trim();
  }
  if (payload.username !== undefined) {
    updates.username = payload.username.trim().toLowerCase();
  }
  if (payload.bio !== undefined) {
    updates.bio = payload.bio.trim().slice(0, BIO_MAX_LENGTH);
  }
  if (payload.photoURL !== undefined) {
    updates.photoURL = payload.photoURL;
  }
  return updates;
}

// ---------------------------------------------------------------------------
// Game history
// ---------------------------------------------------------------------------

export function subscribeToGameHistory(
  uid: string,
  onData: (games: GameSummary[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const gamesRef = collection(db, GAMES);
  const q = query(
    gamesRef,
    where('participants', 'array-contains', uid),
    where('status', '==', 'completed'),
    orderBy('completedAt', 'desc'),
    limit(GAME_HISTORY_LIMIT)
  );

  return onSnapshot(
    q,
    (snap) => {
      const games: GameSummary[] = snap.docs.map((d) => {
        const data = d.data();
        const isPlayer1 = data.player1Uid === uid;
        return {
          id: d.id,
          opponentUid: isPlayer1 ? data.player2Uid : data.player1Uid,
          opponentDisplayName: isPlayer1 ? data.player2DisplayName : data.player1DisplayName,
          opponentUsername: isPlayer1 ? data.player2Username : data.player1Username,
          opponentPhotoURL: isPlayer1 ? data.player2PhotoURL : data.player1PhotoURL,
          result: resolveResult(uid, data),
          myLetters: isPlayer1 ? data.player1Letters : data.player2Letters,
          opponentLetters: isPlayer1 ? data.player2Letters : data.player1Letters,
          completedAt: data.completedAt?.toMillis?.() ?? data.completedAt,
        };
      });
      onData(games);
    },
    onError
  );
}

function resolveResult(
  uid: string,
  gameData: Record<string, unknown>
): 'win' | 'loss' | 'forfeit' {
  if (gameData.forfeitedBy === uid) return 'forfeit';
  if (gameData.winnerUid === uid) return 'win';
  return 'loss';
}

// ---------------------------------------------------------------------------
// Stats helpers (read-only — writes happen in game resolution transaction)
// ---------------------------------------------------------------------------

export function winRate(stats: PlayerStats): number {
  const total = stats.wins + stats.losses + stats.forfeits;
  if (total === 0) return 0;
  return Math.round((stats.wins / total) * 100);
}
