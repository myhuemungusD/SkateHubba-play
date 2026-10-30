/**
 * Decode a Blob into a same-origin HTMLImageElement via the browser's native
 * decoder (Object URL → HTMLImageElement), so no image dependency is needed.
 * Rejects with `avatar_decode_failed` when the bytes are not a decodable image.
 */
export async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("avatar_decode_failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
