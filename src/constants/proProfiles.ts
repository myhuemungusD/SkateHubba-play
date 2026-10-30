/**
 * Pro profile showcase config, keyed by lowercase username.
 *
 * Only what is confirmed lives here: the display name and any signature trick
 * Jason confirmed. Everything biographical (tagline, hometown, sponsors, bio,
 * signature tricks) is written by the pro themself on their own profile and
 * stored on their user doc (`proTagline`, `proHometown`, `proSponsors`,
 * `proBio`, `proSignatureTricks`). Empty fields render nothing, never
 * placeholder copy. Stance is real data from `users/{uid}.stance`.
 */
export interface ProProfileContent {
  displayName: string;
  /** Confirmed defaults only (never invented). Empty = show nothing. */
  signatureTricks: string[];
}

const PRO_PROFILES: Readonly<Record<string, ProProfileContent>> = {
  bryanherman: {
    displayName: "Bryan Herman",
    // Hardflip confirmed by Jason, 2026-10-16. Replaced once Bryan picks his own.
    signatureTricks: ["Hardflip"],
  },
  mikewhite: {
    displayName: "Mike White",
    signatureTricks: [],
  },
};

/** Showcase content for a username, or null when none is configured. */
export function getProProfileContent(username: string | undefined): ProProfileContent | null {
  if (!username) return null;
  return PRO_PROFILES[username.toLowerCase()] ?? null;
}
