import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router";
import { ChevronLeft, MapPin } from "lucide-react";
import type { Spot, SpotComment } from "../types/spot";
import { getSpot, getSpotComments } from "../services/spots";
import { useAuthContext } from "../context/AuthContext";
import { useNavigationContext } from "../context/NavigationContext";
import { useGoBack } from "../hooks/useGoBack";
import { GnarRating } from "../components/map/GnarRating";
import { BustRisk } from "../components/map/BustRisk";
import { SpotChat } from "../components/SpotChat/SpotChat";
import { isMapCheckinsEnabled, isSpotChatsEnabled, isSpotPresenceEnabled } from "../lib/featureFlags";
import { WhosSkatingHere } from "../components/presence/WhosSkatingHere";
import { CheckInButton } from "../components/map/CheckInButton";
import { SpotComments } from "../components/map/SpotComments";

export function SpotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { setScreen, navigateToChallengeWithSpot } = useNavigationContext();
  const backToMap = useGoBack("/map");
  const { user, activeProfile } = useAuthContext();

  const [spot, setSpot] = useState<Spot | null>(null);
  const [comments, setComments] = useState<SpotComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Spot chat errors (send/report failures) surface under the chat.
  const [chatError, setChatError] = useState<string | null>(null);

  // Navigating to another spot re-enters the loading state. Done during
  // render (React's "adjust state when a prop changes" pattern) rather than
  // in the fetch effect, so the effect body never sets state synchronously.
  const [loadedId, setLoadedId] = useState(id);
  if (loadedId !== id) {
    setLoadedId(id);
    if (id) {
      setLoading(true);
      setError(null);
    }
  }

  // Fetch spot and comments with stale-result guard. Firestore has no
  // native request cancellation, so we use a `cancelled` flag to drop
  // results from a query whose effect has already been cleaned up.
  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    Promise.all([getSpot(id), getSpotComments(id)])
      .then(([spotData, commentsData]) => {
        if (cancelled) return;
        if (!spotData) {
          setError("Spot not found");
          return;
        }
        setSpot(spotData);
        setComments(commentsData);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load spot");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handlePosted = useCallback((comment: SpotComment) => setComments((prev) => [comment, ...prev]), []);

  // Route the user into the challenge flow with this spot pre-attached. The
  // `?spot=<uuid>` query param is the contract ChallengeScreen reads, and is
  // also what NavigationContext stashes/restores across the auth bounce so
  // shared links survive sign-in. Mirrors SpotPreviewCard "Challenge from here".
  const handleChallenge = useCallback(() => {
    if (!id) return;
    navigateToChallengeWithSpot(id);
  }, [id, navigateToChallengeWithSpot]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-muted text-sm">Loading spot…</div>
      </div>
    );
  }

  if (error || !spot) {
    return (
      <div className="min-h-dvh bg-background flex flex-col items-center justify-center px-6">
        <p className="text-muted text-sm mb-4">{error ?? "Spot not found"}</p>
        <button
          type="button"
          onClick={() => setScreen("map")}
          className="px-4 py-2 bg-[#F97316] text-white rounded-lg text-sm"
        >
          Back to Map
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-[#222] px-4 pt-safe pb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={backToMap}
          className="-ml-2 inline-flex min-h-11 min-w-11 items-center justify-center text-muted hover:text-white"
          aria-label="Back to map"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-lg font-semibold truncate">{spot.name}</h1>
        {spot.isVerified && (
          <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full">Verified</span>
        )}
      </div>

      <div className="px-4 py-6 max-w-2xl mx-auto space-y-6">
        {/* Photo gallery */}
        {spot.photoUrls.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
            {spot.photoUrls.map((url, i) => (
              <img
                key={url}
                src={url}
                alt={`${spot.name} photo ${i + 1}`}
                className="w-64 h-48 object-cover rounded-xl flex-shrink-0"
              />
            ))}
          </div>
        )}

        {/* Location */}
        <div className="flex items-center gap-2 text-muted text-sm">
          <MapPin size={14} />
          <span>
            {spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)}
          </span>
        </div>

        {/* Ratings */}
        <div className="flex items-center gap-6">
          <div>
            <span className="text-xs text-muted block mb-1">Gnar Rating</span>
            <GnarRating value={spot.gnarRating} />
          </div>
          <div>
            <span className="text-xs text-muted block mb-1">Bust Risk</span>
            <BustRisk value={spot.bustRisk} />
          </div>
        </div>

        {/* Description */}
        {spot.description && <p className="text-[#CCC] text-sm leading-relaxed">{spot.description}</p>}

        {/* Obstacles */}
        {spot.obstacles.length > 0 && (
          <div>
            <h3 className="text-xs text-muted mb-2">Obstacles</h3>
            <div className="flex flex-wrap gap-2">
              {spot.obstacles.map((o) => (
                <span
                  key={o}
                  className="px-3 py-1 text-xs rounded-full bg-surface-alt border border-[#333] text-[#CCC]"
                >
                  {o.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Challenge: with spot presence on, only skaters checked in here. */}
        {isSpotPresenceEnabled() ? (
          <WhosSkatingHere spot={spot} />
        ) : (
          <button
            type="button"
            onClick={handleChallenge}
            className="w-full py-3 rounded-xl bg-[#F97316] text-white font-semibold
                     hover:bg-[#EA580C] transition-colors"
          >
            Challenge to S.K.A.T.E. here
          </button>
        )}

        {/* Check in here too, not only from the map preview card. */}
        {isMapCheckinsEnabled() && <CheckInButton spot={spot} />}

        {/* Spot Chat (feature flagged) */}
        {isSpotChatsEnabled() && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Group Chat</h3>
            <SpotChat
              spotId={spot.id}
              spotName={spot.name}
              currentUserId={user?.uid ?? null}
              onError={(msg) => setChatError(msg)}
            />
            {chatError && <p className="text-red-400 text-xs mt-2">{chatError}</p>}
          </div>
        )}

        <SpotComments
          spotId={spot.id}
          comments={comments}
          onPosted={handlePosted}
          viewer={user && activeProfile ? { uid: user.uid, username: activeProfile.username } : null}
        />
      </div>
    </div>
  );
}
