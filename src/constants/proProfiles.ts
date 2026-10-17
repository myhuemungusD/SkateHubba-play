/**
 * Pro profile showcase content, keyed by lowercase username.
 *
 * REVIEW DATA. Every field with `placeholder: true` is a stand-in that Jason
 * must replace with copy the pro has approved. Nothing biographical here is
 * a fact about the person: taglines, sponsors and hometowns are
 * placeholders until confirmed. Stance is NOT here: it is real data read
 * from the pro's own user doc (`users/{uid}.stance`). Bios and signature
 * tricks are pro-written (`proBio`, `proSignatureTricks`); the only default
 * here is a trick Jason confirmed, shown until the pro picks their own. The UI tags placeholder fields visibly.
 */
export interface ProField {
  value: string;
  /** True until the pro (or Jason on their behalf) confirms the copy. */
  placeholder: boolean;
}

export interface ProProfileContent {
  displayName: string;
  tagline: ProField;
  hometown: ProField;
  sponsors: ProField[];
  /** Confirmed defaults only (never invented). Empty = show nothing. */
  signatureTricks: string[];
}

const ph = (value: string): ProField => ({ value, placeholder: true });

export const PRO_PROFILES: Readonly<Record<string, ProProfileContent>> = {
  bryanherman: {
    displayName: "Bryan Herman",
    tagline: ph("Tagline — one line in Bryan's own words"),
    hometown: ph("Hometown"),
    sponsors: [ph("Sponsor 1"), ph("Sponsor 2"), ph("Sponsor 3")],
    // Hardflip confirmed by Jason, 2026-10-16. Replaced once Bryan picks his own.
    signatureTricks: ["Hardflip"],
  },
  mikewhite: {
    displayName: "Mike White",
    tagline: ph("Tagline — one line in Mike's own words"),
    hometown: ph("Hometown"),
    sponsors: [ph("Shake Junt (confirm)"), ph("Sponsor 2"), ph("Sponsor 3")],
    signatureTricks: [],
  },
};

/** Showcase content for a username, or null when none is configured. */
export function getProProfileContent(username: string | undefined): ProProfileContent | null {
  if (!username) return null;
  return PRO_PROFILES[username.toLowerCase()] ?? null;
}
