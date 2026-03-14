import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  type User,
  type ActionCodeSettings,
} from "firebase/auth";
import { auth, requireAuth } from "../firebase";

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
  // Fire-and-forget verification email
  sendEmailVerification(cred.user, getActionCodeSettings()).catch(() => {});
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

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(requireAuth(), provider);
  return cred.user;
}
