/**
 * Signup password rules. The live project policy is loaded from Firebase
 * (`validatePassword`) when the auth screen mounts. Until that returns, and
 * whenever the fetch fails, the client uses the policy observed on
 * skatehubba.com in October 2026: a number is required and the password may
 * not be longer than 20 characters. Minimum length stays at Firebase's
 * default of 6 unless the project sets one.
 */
export interface SignupPasswordPolicy {
  minLength: number;
  maxLength: number;
  requireNumeric: boolean;
  requireLowercase: boolean;
  requireUppercase: boolean;
  requireNonAlphanumeric: boolean;
}

export const MIRRORED_PASSWORD_POLICY: SignupPasswordPolicy = {
  minLength: 6,
  maxLength: 20,
  requireNumeric: true,
  requireLowercase: false,
  requireUppercase: false,
  requireNonAlphanumeric: false,
};

export type PasswordPolicyIssue = "short" | "long" | "number" | "lower" | "upper" | "symbol";

export function passwordPolicyIssue(
  password: string,
  policy: SignupPasswordPolicy = MIRRORED_PASSWORD_POLICY,
): PasswordPolicyIssue | null {
  if (password.length < policy.minLength) return "short";
  if (password.length > policy.maxLength) return "long";
  if (policy.requireNumeric && !/[0-9]/.test(password)) return "number";
  if (policy.requireLowercase && !/[a-z]/.test(password)) return "lower";
  if (policy.requireUppercase && !/[A-Z]/.test(password)) return "upper";
  if (policy.requireNonAlphanumeric && !/[^a-zA-Z0-9]/.test(password)) return "symbol";
  return null;
}

export function passwordPolicyMessage(
  password: string,
  policy: SignupPasswordPolicy = MIRRORED_PASSWORD_POLICY,
): string | null {
  const issue = passwordPolicyIssue(password, policy);
  switch (issue) {
    case "short":
      return `Password must be at least ${policy.minLength} characters`;
    case "long":
      return `Password may contain at most ${policy.maxLength} characters`;
    case "number":
      return "Password must contain a number";
    case "lower":
      return "Password must contain a lowercase letter";
    case "upper":
      return "Password must contain an uppercase letter";
    case "symbol":
      return "Password must contain a symbol";
    case null:
      return null;
    default: {
      const _exhaustive: never = issue;
      return _exhaustive;
    }
  }
}

/** 1 weak, 2 fair, 3 strong. A password Firebase will reject is always weak. */
export function passwordStrength(password: string, policy: SignupPasswordPolicy = MIRRORED_PASSWORD_POLICY): 1 | 2 | 3 {
  if (passwordPolicyIssue(password, policy)) return 1;
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  if (password.length >= 12 && (hasUpper || hasDigit) && hasSymbol) return 3;
  return 2;
}

export function passwordMeterLabel(
  password: string,
  policy: SignupPasswordPolicy = MIRRORED_PASSWORD_POLICY,
):
  | "Too short"
  | "Too long"
  | "Needs a number"
  | "Needs a letter"
  | "Needs a capital"
  | "Needs a symbol"
  | "Fair"
  | "Strong" {
  const issue = passwordPolicyIssue(password, policy);
  switch (issue) {
    case "short":
      return "Too short";
    case "long":
      return "Too long";
    case "number":
      return "Needs a number";
    case "lower":
      return "Needs a letter";
    case "upper":
      return "Needs a capital";
    case "symbol":
      return "Needs a symbol";
    case null:
      return passwordStrength(password, policy) === 3 ? "Strong" : "Fair";
    default: {
      const _exhaustive: never = issue;
      return _exhaustive;
    }
  }
}
