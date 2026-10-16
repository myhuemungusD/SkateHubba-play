/**
 * Pro profile showcase content, keyed by lowercase username.
 *
 * REVIEW DATA. Every field with `placeholder: true` is a stand-in that Jason
 * must replace with copy the pro has approved. Nothing biographical here is
 * a fact about the person: bios, sponsors, hometowns, stance and tricks are
 * all placeholders until confirmed. The UI tags placeholder fields visibly.
 */
export interface ProField {
  value: string;
  /** True until the pro (or Jason on their behalf) confirms the copy. */
  placeholder: boolean;
}

export interface ProProfileContent {
  displayName: string;
  tagline: ProField;
  bio: ProField;
  hometown: ProField;
  stance: ProField;
  sponsors: ProField[];
  signatureTricks: ProField[];
}

const ph = (value: string): ProField => ({ value, placeholder: true });

export const PRO_PROFILES: Readonly<Record<string, ProProfileContent>> = {
  bryanherman: {
    displayName: "Bryan Herman",
    tagline: ph("Tagline — one line in Bryan's own words"),
    bio: ph(
      "Bio placeholder. Two or three sentences Bryan approves: where he skates, what he's into, what he wants from SkateHubba.",
    ),
    hometown: ph("Hometown"),
    stance: ph("Stance"),
    sponsors: [ph("Sponsor 1"), ph("Sponsor 2"), ph("Sponsor 3")],
    signatureTricks: [ph("Signature trick 1"), ph("Signature trick 2"), ph("Signature trick 3")],
  },
  mikewhite: {
    displayName: "Mike White",
    tagline: ph("Tagline — one line in Mike's own words"),
    bio: ph(
      "Bio placeholder. Two or three sentences Mike approves: where he skates, what he's into, what he wants from SkateHubba.",
    ),
    hometown: ph("Hometown"),
    stance: ph("Stance"),
    sponsors: [ph("Shake Junt (confirm)"), ph("Sponsor 2"), ph("Sponsor 3")],
    signatureTricks: [ph("Signature trick 1"), ph("Signature trick 2"), ph("Signature trick 3")],
  },
};

/** Showcase content for a username, or null when none is configured. */
export function getProProfileContent(username: string | undefined): ProProfileContent | null {
  if (!username) return null;
  return PRO_PROFILES[username.toLowerCase()] ?? null;
}
