/**
 * Shared Cloud Functions caller for the closet callables. firebase/functions
 * is imported on first call so the SDK stays out of the main bundle (same
 * pattern as dice.ts). App Check runs first because every closet callable
 * enforces it; on the website that is the lazy, closet-only path in
 * closetAppCheck.ts.
 */
import * as firebase from "../firebase";
import {
  DeviceCheckError,
  askDeviceCheckRetry,
  ensureClosetAppCheck,
  isDeviceCheckFailure,
  usesLazyWebAppCheck,
} from "./closetAppCheck";
import { logger } from "./logger";

let emulatorConnected = false;

async function invoke<Req, Res>(name: string, data: Req): Promise<Res> {
  await ensureClosetAppCheck();
  const app = firebase.default;
  if (!app) throw new Error("Firebase not initialized");
  const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import("firebase/functions");
  const fns = getFunctions(app, "us-central1");
  if (firebase.isEmulatorMode && !emulatorConnected) {
    connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    emulatorConnected = true;
  }
  // Lazy web mode sends a fresh limited-use token per call, so nothing
  // refreshes in the background after the closet is closed.
  const options = usesLazyWebAppCheck() ? { limitedUseAppCheckTokens: true } : undefined;
  const result = await httpsCallable<Req, Res>(fns, name, options)(data);
  return result.data;
}

/**
 * Call a closet callable. If the device check fails, the retry toast offers
 * another go; the call only rejects (with DeviceCheckError) once the person
 * passes on it, so the screen's own error state is the last word.
 */
export async function callCloset<Req, Res>(name: string, data: Req): Promise<Res> {
  for (;;) {
    try {
      return await invoke<Req, Res>(name, data);
    } catch (err) {
      if (!isDeviceCheckFailure(err)) throw err;
      const code = (err as { code?: unknown }).code;
      logger.warn("closet_device_check_failed", { name, code: typeof code === "string" ? code : "unknown" });
      if (!(await askDeviceCheckRetry())) throw err instanceof DeviceCheckError ? err : new DeviceCheckError();
    }
  }
}
