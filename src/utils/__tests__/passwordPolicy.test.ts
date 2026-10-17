import { describe, expect, it } from "vitest";
import {
  MIRRORED_PASSWORD_POLICY,
  passwordMeterLabel,
  passwordPolicyMessage,
  passwordStrength,
} from "../passwordPolicy";

const strict = {
  ...MIRRORED_PASSWORD_POLICY,
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireNonAlphanumeric: true,
};

describe("passwordPolicyMessage", () => {
  it("names the first unmet requirement", () => {
    expect(passwordPolicyMessage("12345")).toBe("Password must be at least 6 characters");
    expect(passwordPolicyMessage("abcdefghij1234567890x")).toBe("Password may contain at most 20 characters");
    expect(passwordPolicyMessage("abcdefgh")).toBe("Password must contain a number");
    expect(passwordPolicyMessage("ABCDEF1!", strict)).toBe("Password must contain a lowercase letter");
    expect(passwordPolicyMessage("abcdefg1!", strict)).toBe("Password must contain an uppercase letter");
    expect(passwordPolicyMessage("Abcdefg1", strict)).toBe("Password must contain a symbol");
    expect(passwordPolicyMessage("Abcdefg1!")).toBeNull();
  });
});

describe("password meter", () => {
  it("labels policy failures instead of calling them fair", () => {
    expect(passwordMeterLabel("123")).toBe("Too short");
    expect(passwordMeterLabel("a".repeat(21) + "1")).toBe("Too long");
    expect(passwordMeterLabel("abcdefgh")).toBe("Needs a number");
    expect(passwordMeterLabel("ABCDEF1!", strict)).toBe("Needs a letter");
    expect(passwordMeterLabel("abcdefg1!", strict)).toBe("Needs a capital");
    expect(passwordMeterLabel("Abcdefg1", strict)).toBe("Needs a symbol");
  });

  it("labels a policy-valid password fair or strong", () => {
    expect(passwordStrength("abcdef1")).toBe(2);
    expect(passwordMeterLabel("abcdef1")).toBe("Fair");
    expect(passwordMeterLabel("abcdefghijk1!")).toBe("Strong");
  });
});
