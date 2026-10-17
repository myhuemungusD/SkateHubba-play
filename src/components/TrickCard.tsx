/**
 * TrickCard — displays a single trick from the library.
 */
import { useState, useEffect } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import type { TrickLibraryEntry } from "../types/trickLibrary";
import { voteTrick, getUserVote } from "../services/trickLibrary";
import { Btn } from "./ui/Btn";

interface TrickCardProps {
  trick: TrickLibraryEntry;
  onVoteChange?: () => void;
}

export function TrickCard({ trick, onVoteChange }: TrickCardProps) {
  const [userVote, setUserVote] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getUserVote(trick.uid).then(setUserVote);
  }, [trick.uid]);

  const handleVote = async (vote: "up" | "down") => {
    if (busy) return;
    setBusy(true);
    try {
      await voteTrick(trick.uid, vote);
      setUserVote(vote);
      onVoteChange?.();
    } catch (err) {
      console.error("Vote failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const difficultyColors: Record<typeof trick.difficulty, string> = {
    beginner: "text-green-400",
    intermediate: "text-yellow-400",
    advanced: "text-orange-400",
    expert: "text-red-400",
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-white">{trick.name}</h3>
        <span className={`text-xs font-medium ${difficultyColors[trick.difficulty]}`}>{trick.difficulty}</span>
      </div>

      {trick.description && <p className="mb-3 text-sm text-slate-300">{trick.description}</p>}

      {trick.videoUrl && (
        <video src={trick.videoUrl} poster={trick.videoThumbnailUrl} controls className="mb-3 w-full rounded-lg" />
      )}

      <div className="flex items-center gap-3">
        <Btn onClick={() => handleVote("up")} disabled={busy} variant={userVote === "up" ? "primary" : "secondary"}>
          <ThumbsUp size={14} className="mr-1" />
          {trick.upvotes}
        </Btn>
        <Btn onClick={() => handleVote("down")} disabled={busy} variant={userVote === "down" ? "primary" : "secondary"}>
          <ThumbsDown size={14} className="mr-1" />
          {trick.downvotes}
        </Btn>
      </div>
    </div>
  );
}
