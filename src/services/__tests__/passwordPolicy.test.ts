import { beforeEach, describe, expect, it, vi } from "vitest";

const validatePassword = vi.fn();
const requireAuth = vi.fn();

vi.mock("firebase/auth", () => ({
  validatePassword: (...args: unknown[]) => validatePassword(...args),
}));

vi.mock("../../firebase", () => ({
  requireAuth: () => requireAuth(),
}));

import { loadSignupPasswordPolicy, policyFromOptions } from "../passwordPolicy";

describe("policyFromOptions", () => {
  it("fills gaps from the mirrored production policy", () => {
    expect(policyFromOptions(undefined)).toEqual({
      minLength: 6,
      maxLength: 20,
      requireNumeric: true,
      requireLowercase: false,
      requireUppercase: false,
      requireNonAlphanumeric: false,
    });
  });

  it("uses every flag the project actually sets", () => {
    expect(
      policyFromOptions({
        minPasswordLength: 8,
        maxPasswordLength: 16,
        containsNumericCharacter: false,
        containsLowercaseLetter: true,
        containsUppercaseLetter: true,
        containsNonAlphanumericCharacter: true,
      }),
    ).toEqual({
      minLength: 8,
      maxLength: 16,
      requireNumeric: false,
      requireLowercase: true,
      requireUppercase: true,
      requireNonAlphanumeric: true,
    });
  });
});

describe("loadSignupPasswordPolicy", () => {
  beforeEach(() => {
    validatePassword.mockReset();
    requireAuth.mockReset();
    requireAuth.mockReturnValue({ app: "auth" });
  });

  it("reads the live policy from validatePassword", async () => {
    validatePassword.mockResolvedValue({
      passwordPolicy: {
        customStrengthOptions: { maxPasswordLength: 20, containsNumericCharacter: true },
      },
    });
    await expect(loadSignupPasswordPolicy()).resolves.toMatchObject({
      maxLength: 20,
      requireNumeric: true,
      minLength: 6,
    });
    expect(validatePassword).toHaveBeenCalledWith({ app: "auth" }, "0");
  });

  it("returns the mirrored policy when the fetch throws", async () => {
    validatePassword.mockRejectedValue(new Error("appCheck/throttled"));
    await expect(loadSignupPasswordPolicy()).resolves.toMatchObject({ maxLength: 20, requireNumeric: true });
  });

  it("returns the mirrored policy when the failure is not an Error", async () => {
    validatePassword.mockRejectedValue("offline");
    await expect(loadSignupPasswordPolicy()).resolves.toMatchObject({ minLength: 6 });
  });
});
