/**
 * Firebase mock for the closet App Check / callable tests whose app and
 * emulator flag a test can flip. Each file passes its own vi.hoisted state, so
 * the values survive vi.resetModules().
 *
 * This replaces per-test vi.doMock swaps. Queued doMock registrations resolve
 * asynchronously, so under CI load a trailing "restore" doMock could land after
 * the next test's override and win (seen as "Firebase never initialized"
 * resolving instead of rejecting).
 */
import { vi } from "vitest";

export interface FirebaseSwitch {
  app: unknown;
  emulator: boolean;
}

export const firebaseSwitchDefaults = (): FirebaseSwitch => ({ app: { name: "[DEFAULT]" }, emulator: false });

export async function switchableFirebaseMock(state: FirebaseSwitch) {
  const actual = await vi.importActual<typeof import("../../__mocks__/firebase")>("../../__mocks__/firebase");
  return {
    ...actual,
    get default() {
      return state.app;
    },
    get isEmulatorMode() {
      return state.emulator;
    },
  };
}
