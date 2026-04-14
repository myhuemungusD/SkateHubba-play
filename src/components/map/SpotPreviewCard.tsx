import { useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Navigation, BadgeCheck, ImageOff, Flag } from "lucide-react";
import type { Spot } from "../../types/spot";
import { GnarRating } from "./GnarRating";
import { BustRisk } from "./BustRisk";

interface SpotPreviewCardProps {
  spot: Spot;
  onClose: () => void;
  /** When this matches spot.id, the preview shows the "active game" badge. */
  activeGameSpotId?: string;
}

const MAX_VISIBLE_OBSTACLES = 4;

/**
 * Build a cross-platform maps deep link. `google.com/maps/dir/?api=1` is a
 * universal link that iOS/Android/web all respect — Apple Maps intercepts it
 * on iOS, Google Maps on Android, web fallback in desktop browsers. This
 * avoids the `geo:` / `maps:` URL-scheme sniffing tarpit that competitor
 * apps routinely get wrong.
 */
function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

export function SpotPreviewCard({ spot, onClose, activeGameSpotId }: SpotPreviewCardProps) {
  const navigate = useNavigate();
  const touchStartY = useRef<number | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartY.current === null) return;
      const deltaY = e.changedTouches[0].clientY - touchStartY.current;
      if (deltaY > 60) {
        onClose();
      }
      touchStartY.current = null;
    },
    [onClose],
  );

  const visibleObstacles = spot.obstacles.slice(0, MAX_VISIBLE_OBSTACLES);
  const hiddenCount = spot.obstacles.length - MAX_VISIBLE_OBSTACLES;
  const isActiveGame = activeGameSpotId === spot.id;
  const hasPhoto = spot.photoUrls.length > 0 && !photoFailed;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />

      {/* Card */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#1A1A1A] rounded-t-2xl p-4 pb-6 shadow-2xl
                   transform transition-transform duration-250 ease-out translate-y-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        role="dialog"
        aria-label={`Spot: ${spot.name}`}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 bg-[#444] rounded-full mx-auto mb-3" />

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-[#888] hover:text-white transition-colors"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="flex gap-3">
          {/* Photo thumbnail with graceful fallback.
              Competitor complaint: "white rectangle where a picture is supposed
              to be". We render a dimmed placeholder instead of a broken-image
              icon or an empty frame. */}
          {spot.photoUrls.length > 0 && (
            <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-[#0A0A0A] border border-[#2A2A2A] flex items-center justify-center">
              {hasPhoto ? (
                <img
                  src={spot.photoUrls[0]}
                  alt={`${spot.name} photo`}
                  loading="lazy"
                  decoding="async"
                  onError={() => setPhotoFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="flex flex-col items-center justify-center text-[#555]"
                  role="img"
                  aria-label={`Photo unavailable for ${spot.name}`}
                >
                  <ImageOff size={22} aria-hidden="true" />
                </div>
              )}
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Name + verified badge */}
            <div className="flex items-center gap-1.5">
              <h3 className="text-white text-base font-semibold truncate">{spot.name}</h3>
              {spot.isVerified && (
                <BadgeCheck size={16} className="text-[#22C55E] flex-shrink-0" aria-label="Verified spot" />
              )}
            </div>

            {/* Active-game hint — reinforces the map pulse ring with a label,
                so users coming in from a direct URL know why the card matters. */}
            {isActiveGame && (
              <div
                className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide
                           uppercase text-[#F97316]"
                data-testid="active-game-badge"
              >
                <Flag size={10} aria-hidden="true" />
                Your active game
              </div>
            )}

            {/* Ratings */}
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <span className="text-xs text-[#888]">Gnar</span>
                <GnarRating value={spot.gnarRating} size="sm" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-[#888]">Bust</span>
                <BustRisk value={spot.bustRisk} size="sm" />
              </div>
            </div>

            {/* Obstacle tags */}
            {spot.obstacles.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {visibleObstacles.map((o) => (
                  <span key={o} className="px-2 py-0.5 text-xs rounded-full bg-[#333] text-[#CCC]">
                    {o.replace("_", " ")}
                  </span>
                ))}
                {hiddenCount > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-[#333] text-[#888]">+{hiddenCount} more</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Challenge from here — the primary action per charter 2.2:
            the map exists to serve the S.K.A.T.E. game loop, so starting
            a challenge is the dominant affordance on a spot preview. */}
        <button
          type="button"
          onClick={() => navigate(`/challenge?spot=${spot.id}`)}
          className="mt-4 w-full py-2.5 rounded-xl bg-[#F97316] text-white font-semibold text-sm
                     hover:bg-[#EA580C] transition-colors"
        >
          Challenge from here
        </button>

        {/* Secondary actions: View + Directions, split 50/50 so neither steals
            real estate from the primary CTA. "Get directions" is the #1
            requested feature missing from ShredSpots/Smap per user reviews. */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => navigate(`/spots/${spot.id}`)}
            className="py-2.5 rounded-xl bg-[#1A1A1A] border border-[#333] text-[#CCC]
                       font-semibold text-sm hover:bg-[#222] hover:border-[#444] transition-colors"
          >
            View Spot
          </button>
          <a
            href={directionsUrl(spot.latitude, spot.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Get directions to ${spot.name}`}
            className="py-2.5 rounded-xl bg-[#1A1A1A] border border-[#333] text-[#CCC]
                       font-semibold text-sm hover:bg-[#222] hover:border-[#444] transition-colors
                       flex items-center justify-center gap-1.5"
          >
            <Navigation size={14} aria-hidden="true" />
            Directions
          </a>
        </div>
      </div>
    </>
  );
}
