import { useRef, useState } from "react";
import { BannerError, uploadBanner } from "../../../services/banners";
import { CameraIcon } from "../../../components/icons";

interface Props {
  uid: string;
  bannerImageUrl?: string | null;
  isOwnProfile: boolean;
  /** Crop from the custom profile: focal point (0–100 %) and zoom (100–200 %). */
  crop?: { x: number; y: number; zoom: number };
}

const MESSAGES: Record<string, string> = {
  rejected: "That picture can't be used. Try another one.",
  too_large: "That picture is too big. Try a smaller one.",
  too_small: "That picture didn't come through. Try another one.",
};

/**
 * Background picture across the top of a profile (VITE_FEATURE_PROFILE_BANNER).
 * The owner gets one small camera icon to change it; no extra buttons.
 */
export function ProfileBanner({ uid, bannerImageUrl, isOwnProfile, crop }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const src = url ?? bannerImageUrl ?? null;

  if (!src && !isOwnProfile) return null;

  const onPick = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setUrl(await uploadBanner(uid, file));
    } catch (err) {
      setError((err instanceof BannerError && MESSAGES[err.code]) || "Couldn't save that picture. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative -mx-5 -mt-7 mb-4 h-28 overflow-hidden bg-surface-alt" data-testid="profile-banner">
      {src && (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          style={
            crop
              ? {
                  objectPosition: `${crop.x}% ${crop.y}%`,
                  transform: `scale(${crop.zoom / 100})`,
                  transformOrigin: `${crop.x}% ${crop.y}%`,
                }
              : undefined
          }
        />
      )}
      {isOwnProfile && (
        <>
          <button
            type="button"
            aria-label="Change background picture"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="absolute right-2 top-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/15 bg-black/50 text-white backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-50"
          >
            <CameraIcon size={14} />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="banner-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = "";
              void onPick(file);
            }}
          />
        </>
      )}
      {error && (
        <p
          role="alert"
          className="absolute inset-x-2 bottom-2 rounded bg-black/70 px-2 py-1 font-body text-xs text-white"
        >
          {error}
        </p>
      )}
    </div>
  );
}
