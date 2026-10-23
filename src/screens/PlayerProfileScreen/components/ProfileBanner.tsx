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
 * The owner gets one small camera button to change it; no extra buttons.
 *
 * No cover yet: a shorter strip (about 60% of the full height) with the
 * CSS-only brand gradient (`.cover-empty`), for owners and visitors alike. The
 * owner's camera button also reads "Add cover" there.
 */
export function ProfileBanner({ uid, bannerImageUrl, isOwnProfile, crop }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const src = url ?? bannerImageUrl ?? null;

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
    <div
      className={`relative -mx-5 -mt-7 mb-4 overflow-hidden ${src ? "h-28 bg-surface-alt" : `cover-empty ${error ? "h-28" : "h-[68px]"}`}`}
      data-testid="profile-banner"
      data-empty={src ? undefined : "true"}
    >
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
            aria-label={src ? "Change background picture" : "Add cover picture"}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="absolute right-2 top-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-black/50 px-3 text-white backdrop-blur-sm press-feedback focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-50"
          >
            <CameraIcon size={14} />
            {!src && (
              <span aria-hidden="true" className="font-display text-[11px] tracking-wider">
                Add cover
              </span>
            )}
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
