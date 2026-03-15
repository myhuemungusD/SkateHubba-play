import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  deleteUser,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  type User,
  type ActionCodeSettings,
} from "firebase/auth";
import { auth, requireAuth } from "../firebase";
import * as Sentry from "@sentry/react";
import { getErrorCode } from "../utils/helpers";

export type AuthUser = User;

/**
 * Build actionCodeSettings so Firebase email links redirect back to our app.
 * In production this will be your Vercel domain; in dev it falls back to localhost.
 */
function getActionCodeSettings(): ActionCodeSettings {
  const url = import.meta.env.VITE_APP_URL || window.location.origin;
  return { url, handleCodeInApp: false };
}

export function onAuthChange(cb: (user: User | null) => void) {
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
}

export async function signUp(email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(requireAuth(), email, password);
  // Fire-and-forget verification email — failure is non-blocking (user can
  // resend from the lobby banner) but we want visibility in Sentry.
  sendEmailVerification(cred.user, getActionCodeSettings()).catch((err) => {
    Sentry.captureException(err, { extra: { context: "sendEmailVerification on sign-up" } });
  });
  return cred.user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(requireAuth(), email, password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(requireAuth());
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(requireAuth(), email, getActionCodeSettings());
}

export async function resendVerification(): Promise<void> {
  const user = requireAuth().currentUser;
  if (user) {
    await sendEmailVerification(user, getActionCodeSettings());
  }
}

function makeGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // Always show the account chooser so users can switch accounts
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/**
 * Sign in with Google.
 * Uses popup on desktop; falls back to redirect when popups are blocked (mobile/Safari).
 * Returns the signed-in User, or null if a redirect was initiated (onAuthStateChanged
 * will fire automatically once the user returns from Google's OAuth page).
 */
export async function signInWithGoogle(): Promise<User | null> {
  const a = requireAuth();
  const provider = makeGoogleProvider();
  try {
    const cred = await signInWithPopup(a, provider);
    return cred.user;
  } catch (err: unknown) {
    const code = getErrorCode(err);
    if (code === "auth/popup-blocked") {
      // Redirect flow: page navigates to Google; onAuthStateChanged resolves on return
      await signInWithRedirect(a, provider);
      return null;
    }
    throw err;
  }
}

/**
 * Permanently delete the currently signed-in Firebase Auth account.
 *
 * IMPORTANT: Call deleteUserData() from users.ts first to clean up Firestore.
 * Firebase requires recent authentication; if this throws auth/requires-recent-login
 * the caller should sign the user out and ask them to re-authenticate.
 */
export async function deleteAccount(): Promise<void> {
  const user = requireAuth().currentUser;
  if (!user) throw new Error("Not signed in");
  await deleteUser(user);
}

/**
 * Call once on app mount to resolve any pending Google redirect sign-in.
 * Safe to call when no redirect is in progress (returns null).
 */
export async function resolveGoogleRedirect(): Promise<User | null> {
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (err) {
    // Log redirect errors so they're visible in production — previously these
    // were silently swallowed, making Google-redirect failures impossible to debug.
    Sentry.captureException(err, { extra: { context: "resolveGoogleRedirect" } });
    return null;
  }
}
