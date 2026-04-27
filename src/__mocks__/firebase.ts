/**
 * Centralized Firebase mock for all tests.
 *
 * vi.mock("../firebase") in each test file will resolve to this __mocks__ version
 * automatically thanks to Vitest's manual-mock convention.
 */
import { vi } from "vitest";

export const firebaseReady = true;

export const auth = {
  currentUser: null,
};

export const db = {};

export const storage = {};

export const requireDb = vi.fn(() => db);
export const requireAuth = vi.fn(() => auth);
export const requireStorage = vi.fn(() => storage);

export default {}; // default export (the app object)
