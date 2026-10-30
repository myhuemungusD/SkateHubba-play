import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOnboardingContext } from "../OnboardingContext";

describe("useOnboardingContext", () => {
  it("fails loudly when no OnboardingProvider wraps the caller", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useOnboardingContext())).toThrow(
      "useOnboardingContext must be used within OnboardingProvider",
    );
    quiet.mockRestore();
  });
});
