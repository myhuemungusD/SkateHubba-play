/**
 * COPPA/CCPA age-gate helpers. Shared between AuthScreen (email signup) and
 * ProfileSetup (Google signup fallback) so the validation rules stay in one
 * place and both surfaces produce identical dobString / consent results.
 */

/** Minimum age to use the app (COPPA). */
export const MIN_AGE = 13;
/** Age at which parental consent is no longer required. */
export const ADULT_AGE = 18;

/**
 * Age in whole years on `today` for a person born on `dob`. Accounts for
 * birthdays that haven't happened yet this calendar year.
 */
export function getAge(dob: Date, today: Date = new Date()): number {
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/** Structured result of validating three string inputs (month/day/year). */
export type ParsedDob =
  | { kind: "invalid"; message: string }
  | { kind: "blocked"; age: number }
  | { kind: "valid"; age: number; dobString: string; needsParentalConsent: boolean };

/**
 * Parse and validate a month/day/year triple. Returns a discriminated union so
 * callers can switch on `kind` without re-implementing the same branches.
 *
 * - `invalid`: user-facing `message` suitable for an error banner
 * - `blocked`: under-13 — caller renders the COPPA blocked card
 * - `valid`: dobString in YYYY-MM-DD, plus whether parental consent is required
 */
export function parseDob(monthStr: string, dayStr: string, yearStr: string, today: Date = new Date()): ParsedDob {
  const m = parseInt(monthStr, 10);
  const d = parseInt(dayStr, 10);
  const y = parseInt(yearStr, 10);

  if (!m || !d || !y || isNaN(m) || isNaN(d) || isNaN(y)) {
    return { kind: "invalid", message: "Please enter your full date of birth" };
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > today.getFullYear()) {
    return { kind: "invalid", message: "Please enter a valid date" };
  }

  const dob = new Date(y, m - 1, d);
  // Guard against rollovers (Feb 30 → Mar 2, etc.) by verifying the Date the
  // constructor built matches the inputs we gave it.
  if (dob.getMonth() !== m - 1 || dob.getDate() !== d) {
    return { kind: "invalid", message: "Please enter a valid date" };
  }

  const age = getAge(dob, today);
  if (age < MIN_AGE) {
    return { kind: "blocked", age };
  }

  const dobString = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return {
    kind: "valid",
    age,
    dobString,
    needsParentalConsent: age < ADULT_AGE,
  };
}

/**
 * True if the (possibly partial) m/d/y triple already identifies a user
 * between 13 and 17. Used to reveal the parental-consent checkbox as soon as
 * the user has typed enough to be confident — without running full validation.
 */
export function isMinorDob(monthStr: string, dayStr: string, yearStr: string, today: Date = new Date()): boolean {
  const m = parseInt(monthStr, 10);
  const d = parseInt(dayStr, 10);
  const y = parseInt(yearStr, 10);
  if (!m || !d || !y || isNaN(m) || isNaN(d) || isNaN(y)) return false;
  const dob = new Date(y, m - 1, d);
  if (dob.getMonth() !== m - 1) return false;
  const age = getAge(dob, today);
  return age >= MIN_AGE && age < ADULT_AGE;
}
