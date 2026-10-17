import { doc, updateDoc } from "firebase/firestore";
import { requireDb } from "../firebase";
import { containsObjectionableText, OBJECTIONABLE_TEXT_MESSAGE } from "../utils/objectionable";
import { PRO_BIO_MAX, PRO_TRICKS_MAX, TRICK_CATALOG } from "../constants/trickCatalog";

export interface ProProfileEdit {
  bio: string;
  signatureTricks: string[];
}

/**
 * Save a verified pro's own bio and signature tricks. Firestore rules allow
 * this only for the doc owner while `isVerifiedPro` is true, and cap sizes;
 * the client trims and filters to the catalog first so rules never see junk.
 */
export async function saveProProfile(uid: string, edit: ProProfileEdit): Promise<ProProfileEdit> {
  const bio = edit.bio.trim().slice(0, PRO_BIO_MAX);
  if (containsObjectionableText(bio)) throw new Error(OBJECTIONABLE_TEXT_MESSAGE);
  const signatureTricks = [...new Set(edit.signatureTricks)]
    .filter((t) => TRICK_CATALOG.includes(t))
    .slice(0, PRO_TRICKS_MAX);
  await updateDoc(doc(requireDb(), "users", uid), { proBio: bio, proSignatureTricks: signatureTricks });
  return { bio, signatureTricks };
}
