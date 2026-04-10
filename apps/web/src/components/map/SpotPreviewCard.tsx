import { useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import type { Spot } from "@shared/types";
import { GnarRating } from "./GnarRating";
import { BustRisk } from "./BustRisk";

interface SpotPreviewCardProps {
  spot: Spot;
  onClose: () => void;
}

const MAX_VISIBLE_OBSTACLES = 4;

export function SpotPreviewCard({ spot, onClose }: SpotPreviewCardProps) {
  const navigate = useNavigate();
  const touchStartY = useRef<number | null>(null);

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
          {/* Photo thumbnail */}
          {spot.photoUrls.length > 0 && (
            <img
              src={spot.photoUrls[0]}
              alt={`${spot.name} photo`}
              className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
            />
          )}

          <div className="flex-1 min-w-0">
            {/* Name */}
            <h3 className="text-white text-base font-semibold truncate">{spot.name}</h3>

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

        {/* View Spot button */}
        <button
          type="button"
          onClick={() => navigate(`/spots/${spot.id}`)}
          className="mt-4 w-full py-2.5 rounded-xl bg-[#F97316] text-white font-semibold text-sm
                     hover:bg-[#EA580C] transition-colors"
        >
          View Spot
        </button>

        {/* Challenge from here — starts a S.K.A.T.E. challenge pre-seeded with this spot */}
        <button
          type="button"
          onClick={() => navigate(`/challenge?spot=${spot.id}`)}
          className="mt-2 w-full py-2.5 rounded-xl bg-[#1A1A1A] border border-[#F97316] text-[#F97316]
                     font-semibold text-sm hover:bg-[#F97316]/10 transition-colors"
        >
          Challenge from here
        </button>
      </div>
    </>
  );
}
