import { vi } from "vitest";

/** Screen tests that must not hit Firestore. The promise never settles. */
export const getTrainingConsent = vi.fn(() => new Promise<never>(() => {}));
export const isAdultForTraining = (): boolean => false;
export const setTrainingConsent = vi.fn();
export const markTrainingConsentPromptSeen = vi.fn();
export const shouldPromptTrainingConsent = (): boolean => false;

export class TrainingConsentDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainingConsentDeniedError";
  }
}
