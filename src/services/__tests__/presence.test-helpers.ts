/** Shared fakes for the spot presence and online status service tests. */
import { vi } from "vitest";

export class FakeTimestamp {
  constructor(private ms: number) {}
  static fromMillis(ms: number): FakeTimestamp {
    return new FakeTimestamp(ms);
  }
  toMillis(): number {
    return this.ms;
  }
}

export function makeFunctionsMock() {
  const callable = vi.fn();
  return {
    callable,
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => callable),
    connectFunctionsEmulator: vi.fn(),
  };
}
