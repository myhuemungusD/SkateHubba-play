import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, MapPin, Send } from "lucide-react";
import type { Spot, SpotComment } from "../types/spot";
import { getSpot, getSpotComments, addSpotComment } from "../services/spots";
import { useAuthContext } from "../context/AuthContext";
import { GnarRating } from "../components/map/GnarRating";
import { BustRisk } from "../components/map/BustRisk";

export function SpotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const [spot, setSpot] = useState<Spot | null>(null);
  const [comments, setComments] = useState<SpotComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comment form
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Fetch spot and comments with stale-result guard. Firestore has no
  // native request cancellation, so we use a `cancelled` flag to drop
  // results from a query whose effect has already been cleaned up.
  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

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

  const handleSubmitComment = useCallback(async () => {
    if (!commentText.trim() || !id) return;
    if (!user) {
      setCommentError("You must be signed in to comment");
      return;
    }

    setSubmittingComment(true);
    setCommentError(null);

    try {
      const comment = await addSpotComment(id, commentText.trim(), user.uid);
      setComments((prev) => [comment, ...prev]);
      setCommentText("");
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmittingComment(false);
    }
  }, [commentText, id, user]);

  // Route the user into the challenge flow with this spot pre-attached. The
  // `?spot=<uuid>` query param is the contract ChallengeScreen reads, and is
  // also what NavigationContext stashes/restores across the auth bounce so
  // shared links survive sign-in. Mirrors SpotPreviewCard "Challenge from here".
  const handleChallenge = useCallback(() => {
    if (!id) return;
    navigate(`/challenge?spot=${id}`);
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-[#888] text-sm">Loading spot\u2026</div>
      </div>
    );
  }

  if (error || !spot) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A] flex flex-col items-center justify-center px-6">
        <p className="text-[#888] text-sm mb-4">{error ?? "Spot not found"}</p>
        <button
          type="button"
          onClick={() => navigate("/map")}
          className="px-4 py-2 bg-[#F97316] text-white rounded-lg text-sm"
        >
          Back to Map
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0A0A0A] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0A0A0A]/95 backdrop-blur border-b border-[#222] px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/map")}
          className="text-[#888] hover:text-white"
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
        <div className="flex items-center gap-2 text-[#888] text-sm">
          <MapPin size={14} />
          <span>
            {spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)}
          </span>
        </div>

        {/* Ratings */}
        <div className="flex items-center gap-6">
          <div>
            <span className="text-xs text-[#888] block mb-1">Gnar Rating</span>
            <GnarRating value={spot.gnarRating} />
          </div>
          <div>
            <span className="text-xs text-[#888] block mb-1">Bust Risk</span>
            <BustRisk value={spot.bustRisk} />
          </div>
        </div>

        {/* Description */}
        {spot.description && <p className="text-[#CCC] text-sm leading-relaxed">{spot.description}</p>}

        {/* Obstacles */}
        {spot.obstacles.length > 0 && (
          <div>
            <h3 className="text-xs text-[#888] mb-2">Obstacles</h3>
            <div className="flex flex-wrap gap-2">
              {spot.obstacles.map((o) => (
                <span key={o} className="px-3 py-1 text-xs rounded-full bg-[#1A1A1A] border border-[#333] text-[#CCC]">
                  {o.replace("_", " ")}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Challenge button */}
        <button
          type="button"
          onClick={handleChallenge}
          className="w-full py-3 rounded-xl bg-[#F97316] text-white font-semibold
                     hover:bg-[#EA580C] transition-colors"
        >
          Challenge to S.K.A.T.E. here
        </button>

        {/* Comments */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Comments</h3>

          {/* Add comment form */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              maxLength={300}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment\u2026"
              className="flex-1 bg-[#1A1A1A] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                         placeholder:text-[#555] focus:outline-none focus:border-[#F97316]"
            />
            <button
              type="button"
              onClick={handleSubmitComment}
              disabled={submittingComment || !commentText.trim()}
              className="px-3 py-2 bg-[#F97316] text-white rounded-lg
                         hover:bg-[#EA580C] disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Send comment"
            >
              <Send size={16} />
            </button>
          </div>

          {commentError && <p className="text-red-400 text-xs mb-3">{commentError}</p>}

          {/* Comment list */}
          {comments.length === 0 ? (
            <p className="text-[#555] text-sm">No comments yet. Be the first!</p>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="bg-[#1A1A1A] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[#888]">{c.userId.slice(0, 8)}\u2026</span>
                    <span className="text-xs text-[#555]">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-[#CCC]">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
