import { doc, updateDoc } from "firebase/firestore";
import { requireDb } from "../firebase";
import {
  PRO_BIO_MAX,
  PRO_HOMETOWN_MAX,
  PRO_SPONSOR_MAX,
  PRO_SPONSORS_MAX,
  PRO_TAGLINE_MAX,
  PRO_TRICKS_MAX,
  TRICK_CATALOG,
} from "../constants/trickCatalog";

export interface ProProfileEdit {
  bio: string;
  signatureTricks: string[];
  tagline: string;
  hometown: string;
  sponsors: string[];
}

const clean = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Save a verified pro's own profile copy. Firestore rules allow this only for
 * the doc owner while `isVerifiedPro` is true, and cap sizes; the client trims
 * and filters first so rules never see junk. Empty strings mean "not set".
 */
export async function saveProProfile(uid: string, edit: ProProfileEdit): Promise<ProProfileEdit> {
  const bio = edit.bio.trim().slice(0, PRO_BIO_MAX);
  const signatureTricks = [...new Set(edit.signatureTricks)]
    .filter((t) => TRICK_CATALOG.includes(t))
    .slice(0, PRO_TRICKS_MAX);
  const tagline = clean(edit.tagline, PRO_TAGLINE_MAX);
  const hometown = clean(edit.hometown, PRO_HOMETOWN_MAX);
  const sponsors = [...new Set(edit.sponsors.map((s) => clean(s, PRO_SPONSOR_MAX)).filter(Boolean))].slice(
    0,
    PRO_SPONSORS_MAX,
  );
  await updateDoc(doc(requireDb(), "users", uid), {
    proBio: bio,
    proSignatureTricks: signatureTricks,
    proTagline: tagline,
    proHometown: hometown,
    proSponsors: sponsors,
  });
  return { bio, signatureTricks, tagline, hometown, sponsors };
}
