import { useState, useRef, useCallback, useEffect } from "react";
import type { GameDoc } from "../services/games";
import { setTrick, failSetTrick, submitMatchAttempt, submitConfirmation, forfeitExpiredTurn } from "../services/games";
import { uploadVideo, type UploadProgress as UploadProgressData } from "../services/storage";
import type { UserProfile } from "../services/users";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { captureException } from "../lib/sentry";
import { sendNudge, canNudge } from "../services/nudge";
import { Btn } from "../components/ui/Btn";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Field } from "../components/ui/Field";
import { LetterDisplay } from "../components/LetterDisplay";
import { Timer } from "../components/Timer";
import { VideoRecorder } from "../components/VideoRecorder";
import { UploadProgress } from "../components/UploadProgress";
import { TurnHistoryViewer } from "../components/TurnHistoryViewer";

export function GamePlayScreen({ game, profile, onBack }: { game: GameDoc; profile: UserProfile; onBack: () => void }) {
  const [trickName, setTrickName] = useState("");
  const trickNameRef = useRef(trickName);
  trickNameRef.current = trickName;
  const recorderRevealedRef = useRef(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoRecorded, setVideoRecorded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [setterAction, setSetterAction] = useState<"landed" | "missed" | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressData | null>(null);
  const [forfeitChecked, setForfeitChecked] = useState(false);
  const [nudgeStatus, setNudgeStatus] = useState<"idle" | "pending" | "sent" | "error">("idle");
  const [nudgeError, setNudgeError] = useState("");

  useEffect(() => {
    if (forfeitChecked || game.status !== "active") return;
    const deadline = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadline > 0 && Date.now() >= deadline) {
      forfeitExpiredTurn(game.id).catch((err) => {
        console.warn("Forfeit check failed:", err instanceof Error ? err.message : err);
        captureException(err, { extra: { context: "forfeitExpiredTurn", gameId: game.id } });
      });
    }
    setForfeitChecked(true);
  }, [game.id, game.status, forfeitChecked, game.turnDeadline]);

  const isSetter = game.phase === "setting" && game.currentSetter === profile.uid;
  const isMatcher = game.phase === "matching" && game.currentTurn === profile.uid;
  const isConfirming = game.phase === "confirming";
  const isSetterInGame = game.currentSetter === profile.uid;
  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
  const matcherUsername = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

  const trimmedTrickName = trickName.trim();
  if (isSetter && trimmedTrickName) recorderRevealedRef.current = true;
  const showRecorder = !isSetter || recorderRevealedRef.current;

  const submittedRef = useRef(false);
  const submitSetterTrick = useCallback(
    async (blob: Blob | null) => {
      /* v8 ignore start */
      if (submittedRef.current) return;
      /* v8 ignore stop */
      submittedRef.current = true;
      setSetterAction("landed");
      setSubmitting(true);
      setError("");
      try {
        let videoUrl: string | null = null;
        if (blob) {
          setUploadProgress({ bytesTransferred: 0, totalBytes: blob.size, percent: 0 });
          videoUrl = await uploadVideo(game.id, game.turnNumber, "set", blob, setUploadProgress);
        }
        setUploadProgress(null);
        await setTrick(game.id, trickNameRef.current.trim() || "Trick", videoUrl);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to send trick");
        setUploadProgress(null);
        submittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [game.id, game.turnNumber],
  );

  const submitSetterMissed = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSetterAction("missed");
    setSubmitting(true);
    setError("");
    try {
      await failSetTrick(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit result");
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [game.id]);

  const handleRecorded = useCallback((blob: Blob | null) => {
    setVideoBlob(blob);
    setVideoRecorded(true);
  }, []);

  // Submit match attempt (upload video, transition to confirming phase)
  const matchSubmittedRef = useRef(false);
  const submitMatchVideo = useCallback(async () => {
    /* v8 ignore start */
    if (matchSubmittedRef.current) return;
    /* v8 ignore stop */
    matchSubmittedRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      let videoUrl: string | null = null;
      if (videoBlob) {
        setUploadProgress({ bytesTransferred: 0, totalBytes: videoBlob.size, percent: 0 });
        videoUrl = await uploadVideo(game.id, game.turnNumber, "match", videoBlob, setUploadProgress);
      }
      setUploadProgress(null);
      await submitMatchAttempt(game.id, videoUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit attempt");
      setUploadProgress(null);
      matchSubmittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [game.id, game.turnNumber, videoBlob]);

  // Submit confirmation vote
  const confirmSubmittedRef = useRef(false);
  const submitVote = useCallback(
    async (landed: boolean) => {
      if (confirmSubmittedRef.current) return;
      confirmSubmittedRef.current = true;
      setSubmitting(true);
      setError("");
      try {
        await submitConfirmation(game.id, profile.uid, landed);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to submit vote");
        confirmSubmittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [game.id, profile.uid],
  );

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const deadline = game.turnDeadline?.toMillis?.() || Date.now() + 86400000;

  // Determine if this player already voted in confirming phase
  const myConfirm = isSetterInGame ? game.setterConfirm : game.matcherConfirm;
  const theirConfirm = isSetterInGame ? game.matcherConfirm : game.setterConfirm;

  // ── Confirming phase: both players review clips and vote ──
  if (isConfirming) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A]/80 pb-10">
        <div className="px-5 py-4 border-b border-border flex justify-between items-center">
          <button type="button" onClick={onBack} className="font-body text-sm text-[#888]">
            ← Games
          </button>
          <Timer deadline={deadline} />
        </div>

        <div className="px-5 pt-5 max-w-md mx-auto">
          <div className="flex justify-center gap-5 mb-6">
            <LetterDisplay count={myLetters} name={`@${profile.username}`} active={false} />
            <div className="flex items-center font-display text-2xl text-[#555]">VS</div>
            <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={false} />
          </div>

          <div className="text-center py-3 px-5 mb-5 rounded-xl border bg-[rgba(147,51,234,0.06)] border-purple-500">
            <span className="font-display text-xl tracking-wider text-purple-400">
              Review: {game.currentTrickName || "Trick"}
            </span>
          </div>

          <p className="font-display text-sm tracking-wider text-[#888] mb-1 text-center">
            Both players must agree the trick was landed
          </p>

          {/* Setter's clip */}
          {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) && (
            <div className="mb-5">
              <p className="font-display text-sm tracking-wider text-brand-orange mb-2">@{setterUsername}'s TRICK</p>
              <video
                src={game.currentTrickVideoUrl}
                controls
                playsInline
                preload="metadata"
                aria-label={`Video of ${game.currentTrickName || "trick"} set by ${setterUsername}`}
                className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
              />
            </div>
          )}

          {/* Matcher's clip */}
          {game.matchVideoUrl && isFirebaseStorageUrl(game.matchVideoUrl) && (
            <div className="mb-5">
              <p className="font-display text-sm tracking-wider text-brand-green mb-2">@{matcherUsername}'s ATTEMPT</p>
              <video
                src={game.matchVideoUrl}
                controls
                playsInline
                preload="metadata"
                aria-label={`Video of ${game.currentTrickName || "trick"} attempted by ${matcherUsername}`}
                className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
              />
            </div>
          )}

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          {/* Vote buttons (only if not yet voted) */}
          {myConfirm === null && !submitting && (
            <div className="mt-5" role="group" aria-label="Did the matcher land the trick?">
              <p className="font-display text-xl text-white text-center mb-4">Did @{matcherUsername} land it?</p>
              <div className="flex gap-3">
                <Btn onClick={() => submitVote(true)} variant="success" disabled={submitting}>
                  ✓ Landed
                </Btn>
                <Btn onClick={() => submitVote(false)} variant="danger" disabled={submitting}>
                  ✗ Missed
                </Btn>
              </div>
            </div>
          )}

          {/* Submitting state */}
          {submitting && (
            <div className="mt-5 text-center">
              <span className="font-display text-lg text-purple-400 tracking-wider animate-pulse">
                Submitting vote...
              </span>
            </div>
          )}

          {/* Already voted, waiting for opponent */}
          {myConfirm !== null && theirConfirm === null && (
            <div className="mt-5 text-center">
              <p className="font-display text-lg text-white mb-2">You voted: {myConfirm ? "✓ Landed" : "✗ Missed"}</p>
              <span className="font-display text-sm text-[#888] tracking-wider animate-pulse">
                Waiting for @{opponentName} to vote...
              </span>
            </div>
          )}

          {(game.turnHistory?.length ?? 0) > 0 && (
            <TurnHistoryViewer turns={game.turnHistory!} currentUserUid={profile.uid} />
          )}
        </div>
      </div>
    );
  }

  // ── Waiting screen (not your turn in setting/matching) ──
  const nudgeAvailable = nudgeStatus !== "sent" && canNudge(game.id);

  if (!isSetter && !isMatcher) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A]/80 flex flex-col items-center px-6 py-8 overflow-y-auto">
        <div className="text-center max-w-sm animate-fade-in">
          <span className="text-5xl block mb-4">⏳</span>
          <h2 className="font-display text-3xl text-white mb-2">Waiting on @{opponentName}</h2>
          <p className="font-body text-sm text-[#888] mb-2">
            {game.phase === "setting"
              ? "They're setting a trick for you to match."
              : "They're attempting to match your trick."}
          </p>
          <Timer deadline={deadline} />

          {game.status === "active" && (
            <div className="mt-6">
              <Btn
                onClick={async () => {
                  setNudgeStatus("pending");
                  setNudgeError("");
                  try {
                    const opponentUid = game.player1Uid === profile.uid ? game.player2Uid : game.player1Uid;
                    await sendNudge({
                      gameId: game.id,
                      senderUid: profile.uid,
                      senderUsername: profile.username,
                      recipientUid: opponentUid,
                    });
                    setNudgeStatus("sent");
                  } catch (err: unknown) {
                    setNudgeError(err instanceof Error ? err.message : "Failed to nudge");
                    setNudgeStatus("error");
                  }
                }}
                variant="secondary"
                disabled={nudgeStatus === "pending" || !nudgeAvailable}
              >
                {nudgeStatus === "sent" ? "Nudge Sent" : nudgeStatus === "pending" ? "Nudging..." : "Nudge"}
              </Btn>
              {nudgeError && <p className="font-body text-xs text-brand-red mt-2 text-center">{nudgeError}</p>}
              {nudgeStatus === "sent" && (
                <p className="font-body text-xs text-[#888] mt-2 text-center">They&apos;ll get a push notification</p>
              )}
              {!nudgeAvailable && nudgeStatus !== "sent" && (
                <p className="font-body text-xs text-[#666] mt-2 text-center">Nudge available every 4 hours</p>
              )}
            </div>
          )}

          <div className="mt-8">
            <Btn onClick={onBack} variant="ghost">
              ← Back to Games
            </Btn>
          </div>

          {game.phase === "matching" &&
            game.currentTrickVideoUrl &&
            isFirebaseStorageUrl(game.currentTrickVideoUrl) && (
              <div className="mt-6 w-full max-w-sm">
                <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
                  Your Trick: {game.currentTrickName || "Trick"}
                </p>
                <video
                  src={game.currentTrickVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`Video of ${game.currentTrickName || "trick"} you set`}
                  className="w-full max-w-[280px] mx-auto aspect-[9/16] rounded-xl bg-black object-cover border border-border"
                />
              </div>
            )}

          {(game.turnHistory?.length ?? 0) > 0 && (
            <div className="mt-4 text-left w-full max-w-sm">
              <TurnHistoryViewer turns={game.turnHistory!} currentUserUid={profile.uid} defaultExpanded />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/80 pb-10">
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
              ? trimmedTrickName
                ? `Set your ${trimmedTrickName}`
                : "Name your trick"
              : `Match @${game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username}'s ${game.currentTrickName || "trick"}`}
          </span>
        </div>

        {isMatcher && game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) && (
          <div className="mb-5">
            <p className="font-display text-sm tracking-wider text-[#888] mb-2">THEIR ATTEMPT</p>
            <video
              src={game.currentTrickVideoUrl}
              controls
              playsInline
              preload="auto"
              aria-label={`Video of ${game.currentTrickName || "trick"} set by opponent`}
              className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
            />
          </div>
        )}

        {isSetter && (
          <Field
            label="TRICK NAME"
            value={trickName}
            onChange={setTrickName}
            placeholder="e.g. Kickflip, 360 Flip"
            maxLength={60}
            disabled={videoRecorded}
            autoCapitalize="words"
            note={!showRecorder ? "Name your trick to start recording" : undefined}
          />
        )}

        {showRecorder && (
          <VideoRecorder
            onRecorded={handleRecorded}
            label={isSetter ? "Land Your Trick" : `Match the ${game.currentTrickName || "Trick"}`}
            autoOpen={isSetter}
            doneLabel="Recorded"
          />
        )}

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {isSetter && videoRecorded && !submitting && !error && (
          <div className="mt-5" role="group" aria-label="Did you land the trick?">
            <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
            <div className="flex gap-3">
              <Btn onClick={() => submitSetterTrick(videoBlob)} variant="success" disabled={submitting}>
                ✓ Landed
              </Btn>
              <Btn onClick={submitSetterMissed} variant="danger" disabled={submitting}>
                ✗ Missed
              </Btn>
            </div>
          </div>
        )}
        {isSetter && submitting && (
          <div className="mt-5 text-center">
            {uploadProgress ? (
              <UploadProgress progress={uploadProgress} />
            ) : (
              <span className="font-display text-lg text-brand-orange tracking-wider animate-pulse">
                {setterAction === "missed" ? "Passing turn..." : `Sending to @${opponentName}...`}
              </span>
            )}
          </div>
        )}
        {isSetter && !submitting && error && videoRecorded && (
          <div className="mt-5">
            <Btn
              onClick={setterAction === "missed" ? submitSetterMissed : () => submitSetterTrick(videoBlob)}
              variant="secondary"
            >
              Retry
            </Btn>
          </div>
        )}

        {isMatcher && videoRecorded && (
          <div className="mt-5" role="group" aria-label="Submit your attempt">
            {uploadProgress ? (
              <UploadProgress progress={uploadProgress} />
            ) : (
              <>
                <p className="font-display text-xl text-white text-center mb-4">Submit your attempt for review</p>
                <Btn onClick={submitMatchVideo} variant="success" disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit Attempt"}
                </Btn>
              </>
            )}
          </div>
        )}

        {(game.turnHistory?.length ?? 0) > 0 && (
          <TurnHistoryViewer turns={game.turnHistory!} currentUserUid={profile.uid} />
        )}
      </div>
    </div>
  );
}
