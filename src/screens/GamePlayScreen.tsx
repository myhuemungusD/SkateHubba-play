import { useState, useRef, useCallback, useEffect, useId } from "react";
import type { GameDoc } from "../services/games";
import { setTrick, submitMatchResult, forfeitExpiredTurn } from "../services/games";
import { uploadVideo } from "../services/storage";
import type { UserProfile } from "../services/users";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { Btn } from "../components/ui/Btn";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { LetterDisplay } from "../components/LetterDisplay";
import { Timer } from "../components/Timer";
import { VideoRecorder } from "../components/VideoRecorder";

export function GamePlayScreen({ game, profile, onBack }: { game: GameDoc; profile: UserProfile; onBack: () => void }) {
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoRecorded, setVideoRecorded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [forfeitChecked, setForfeitChecked] = useState(false);
  const [trickName, setTrickName] = useState("");
  const trickNameId = useId();
  const trickNameRef = useRef(trickName);
  trickNameRef.current = trickName;

  useEffect(() => {
    if (forfeitChecked || game.status !== "active") return;
    const deadline = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadline > 0 && Date.now() >= deadline) {
      forfeitExpiredTurn(game.id).catch((err) => {
        console.warn("Forfeit check failed:", err instanceof Error ? err.message : err);
      });
    }
    setForfeitChecked(true);
  }, [game.id, game.status, forfeitChecked, game.turnDeadline]);

  const isSetter = game.phase === "setting" && game.currentSetter === profile.uid;
  const isMatcher = game.phase === "matching" && game.currentTurn === profile.uid;
  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;

  const submittedRef = useRef(false);
  const submitSetterTrick = useCallback(
    async (blob: Blob | null) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setError("");
      try {
        let videoUrl: string | null = null;
        if (blob) {
          videoUrl = await uploadVideo(game.id, game.turnNumber, "set", blob);
        }
        await setTrick(game.id, trickNameRef.current || "Trick", videoUrl);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to send trick");
        submittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [game.id, game.turnNumber],
  );

  const handleSetterRecorded = useCallback(
    (blob: Blob | null) => {
      setVideoBlob(blob);
      setVideoRecorded(true);
      submitSetterTrick(blob);
    },
    [submitSetterTrick],
  );

  const handleRecorded = useCallback((blob: Blob | null) => {
    setVideoBlob(blob);
    setVideoRecorded(true);
  }, []);

  const matchSubmittedRef = useRef(false);
  const submitResult = async (landed: boolean) => {
    if (matchSubmittedRef.current) return;
    matchSubmittedRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      let videoUrl: string | null = null;
      if (videoBlob) {
        videoUrl = await uploadVideo(game.id, game.turnNumber, "match", videoBlob);
      }
      await submitMatchResult(game.id, landed, videoUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit result");
      matchSubmittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const deadline = game.turnDeadline?.toMillis?.() || Date.now() + 86400000;

  if (!isSetter && !isMatcher) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A] flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-sm animate-fade-in">
          <span className="text-5xl block mb-4">⏳</span>
          <h2 className="font-display text-3xl text-white mb-2">Waiting on @{opponentName}</h2>
          <p className="font-body text-sm text-[#888] mb-2">
            {game.phase === "setting"
              ? "They're setting a trick for you to match."
              : "They're attempting to match your trick."}
          </p>
          <Timer deadline={deadline} />
          <div className="mt-8">
            <Btn onClick={onBack} variant="ghost">
              ← Back to Games
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0A0A0A] pb-10">
      <div className="px-5 py-4 border-b border-border flex justify-between items-center">
        <button type="button" onClick={onBack} className="font-body text-sm text-[#888]">
          ← Games
        </button>
        <Timer deadline={deadline} />
      </div>

      <div className="px-5 pt-5 max-w-md mx-auto">
        <div className="flex justify-center gap-5 mb-6">
          <LetterDisplay count={myLetters} name={`@${profile.username}`} active={isSetter} />
          <div className="flex items-center font-display text-2xl text-[#555]">VS</div>
          <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={isMatcher} />
        </div>

        <div
          className={`text-center py-3 px-5 mb-5 rounded-xl border
            ${isSetter ? "bg-[rgba(255,107,0,0.06)] border-brand-orange" : "bg-[rgba(0,230,118,0.06)] border-brand-green"}`}
        >
          <span
            className={`font-display text-xl tracking-wider ${isSetter ? "text-brand-orange" : "text-brand-green"}`}
          >
            {isSetter
              ? "Set your trick"
              : `Match @${game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username}'s ${game.currentTrickName || "trick"}`}
          </span>
        </div>

        {isSetter && (
          <div className="mb-5">
            <label htmlFor={trickNameId} className="block font-display text-sm tracking-wider text-[#888] mb-1.5">
              TRICK NAME
            </label>
            <input
              id={trickNameId}
              type="text"
              value={trickName}
              onChange={(e) => setTrickName(e.target.value)}
              placeholder="e.g. Kickflip"
              maxLength={100}
              disabled={videoRecorded}
              className="w-full bg-surface-alt border border-border rounded-xl px-4 py-3 font-body text-white placeholder:text-[#444] focus:outline-none focus:border-brand-orange disabled:opacity-50 transition-colors"
            />
          </div>
        )}

        {isMatcher && game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) && (
          <div className="mb-5">
            <p className="font-display text-sm tracking-wider text-[#888] mb-2">THEIR ATTEMPT</p>
            <video
              src={game.currentTrickVideoUrl}
              controls
              aria-label={`Video of ${game.currentTrickName || "trick"} set by opponent`}
              className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
            />
          </div>
        )}

        <VideoRecorder
          onRecorded={isSetter ? handleSetterRecorded : handleRecorded}
          label={isSetter ? "Land Your Trick" : `Match the ${game.currentTrickName || "Trick"}`}
          autoOpen={isSetter}
          doneLabel={isSetter ? "Recorded — Sending..." : "Recorded"}
        />

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {isSetter && submitting && (
          <div className="mt-5 text-center">
            <span className="font-display text-lg text-brand-orange tracking-wider animate-pulse">
              Sending to @{opponentName}...
            </span>
          </div>
        )}
        {isSetter && !submitting && error && videoRecorded && (
          <div className="mt-5">
            <Btn onClick={() => submitSetterTrick(videoBlob)} variant="secondary">
              Retry Send
            </Btn>
          </div>
        )}

        {isMatcher && videoRecorded && (
          <div className="mt-5" role="group" aria-label="Did you land the trick?">
            <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
            <div className="flex gap-3">
              <Btn onClick={() => submitResult(true)} variant="success" disabled={submitting}>
                {submitting ? "..." : "✓ Landed"}
              </Btn>
              <Btn onClick={() => submitResult(false)} variant="danger" disabled={submitting}>
                {submitting ? "..." : "✗ Missed"}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
