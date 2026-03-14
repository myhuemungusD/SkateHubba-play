import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { requireStorage } from "../firebase";

/**
 * Upload a video blob to Firebase Storage and return the download URL.
 *
 * Path: games/{gameId}/turn-{turnNumber}/{role}.webm
 * role = "set" | "match"
 */
export async function uploadVideo(
  gameId: string,
  turnNumber: number,
  role: "set" | "match",
  blob: Blob
): Promise<string> {
  const path = `games/${gameId}/turn-${turnNumber}/${role}.webm`;
  const storageRef = ref(requireStorage(), path);

  await uploadBytes(storageRef, blob, {
    contentType: "video/webm",
    customMetadata: {
      gameId,
      turn: String(turnNumber),
      role,
      uploadedAt: new Date().toISOString(),
    },
  });

  return getDownloadURL(storageRef);
}
