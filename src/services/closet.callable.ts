/**
 * Shared Cloud Functions caller for the closet callables. firebase/functions
 * is imported on first call so the SDK stays out of the main bundle (same
 * pattern as dice.ts). App Check runs first because every closet callable
 * enforces it.
 */
import * as firebase from "../firebase";

let emulatorConnected = false;

export async function callCloset<Req, Res>(name: string, data: Req): Promise<Res> {
  await firebase.ensureAppCheck();
  const app = firebase.default;
  if (!app) throw new Error("Firebase not initialized");
  const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import("firebase/functions");
  const fns = getFunctions(app, "us-central1");
  if (firebase.isEmulatorMode && !emulatorConnected) {
    connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    emulatorConnected = true;
  }
  const result = await httpsCallable<Req, Res>(fns, name)(data);
  return result.data;
}
