/** Shared types, styles and the native capture helper for AvatarPicker. */

export type AvatarSource = "camera" | "gallery" | "url";
export type Screen = "menu" | "preview" | "url";

export interface Pending {
  blob: Blob;
  source: AvatarSource;
  previewUrl: string;
  originalSizeBytes: number;
}

export const ACCEPT = "image/webp,image/jpeg,image/png";
export const SHEET_CLASS =
  "fixed inset-x-0 bottom-0 z-50 bg-background border-t border-border rounded-t-2xl px-5 pt-5 pb-8 max-h-[80dvh] overflow-y-auto motion-safe:animate-slide-up";
export const PRIMARY_BTN =
  "min-h-[44px] rounded-xl bg-brand-orange text-on-brand font-display text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
export const GHOST_BTN =
  "min-h-[44px] rounded-xl border border-border text-muted font-display text-sm hover:text-white hover:border-border-hover transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
export const MENU_BTN =
  "w-full min-h-[44px] py-3 rounded-xl glass-card text-white font-display text-sm hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

/**
 * True when @capacitor/camera rejected because the user dismissed the picker
 * ("User cancelled photos app" on iOS and Android), not because access failed.
 */
export function isPickerCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

/**
 * Capture a Blob from the native Capacitor Camera plugin. Lazy import
 * so the plugin only lands on the upload code path.
 */
export async function captureFromCapacitor(source: AvatarSource): Promise<Blob | null> {
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  const photo = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
    promptLabelHeader: "Choose profile picture",
  });
  if (!photo.base64String || !photo.format) return null;
  const bytes = Uint8Array.from(atob(photo.base64String), (c) => c.charCodeAt(0));
  const mime = photo.format === "png" ? "image/png" : photo.format === "webp" ? "image/webp" : "image/jpeg";
  return new Blob([bytes], { type: mime });
}
