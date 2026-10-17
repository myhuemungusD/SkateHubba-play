import { validatePassword } from "firebase/auth";
import { requireAuth } from "../firebase";
import { logger } from "./logger";
import { MIRRORED_PASSWORD_POLICY, type SignupPasswordPolicy } from "../utils/passwordPolicy";

interface PolicyOptions {
  minPasswordLength?: number;
  maxPasswordLength?: number;
  containsLowercaseLetter?: boolean;
  containsUppercaseLetter?: boolean;
  containsNumericCharacter?: boolean;
  containsNonAlphanumericCharacter?: boolean;
}

/** Map a Firebase password-policy payload onto the signup checker. */
export function policyFromOptions(options: PolicyOptions | undefined): SignupPasswordPolicy {
  return {
    minLength: options?.minPasswordLength ?? MIRRORED_PASSWORD_POLICY.minLength,
    maxLength: options?.maxPasswordLength ?? MIRRORED_PASSWORD_POLICY.maxLength,
    requireLowercase: options?.containsLowercaseLetter === true,
    requireUppercase: options?.containsUppercaseLetter === true,
    requireNumeric: options?.containsNumericCharacter ?? MIRRORED_PASSWORD_POLICY.requireNumeric,
    requireNonAlphanumeric: options?.containsNonAlphanumericCharacter === true,
  };
}

/**
 * Read the project's password policy from Identity Toolkit. A failed fetch
 * (offline, App Check throttle, emulator without the endpoint) keeps the
 * mirrored production policy so signup still rejects the shapes Firebase rejects.
 */
export async function loadSignupPasswordPolicy(): Promise<SignupPasswordPolicy> {
  try {
    const status = await validatePassword(requireAuth(), "0");
    return policyFromOptions(status.passwordPolicy.customStrengthOptions);
  } catch (err) {
    logger.warn("password_policy_fetch_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return MIRRORED_PASSWORD_POLICY;
  }
}
