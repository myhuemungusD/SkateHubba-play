import { useState, useRef, useCallback, useEffect } from "react";
import type { GameDoc } from "../services/games";
import { setTrick, failSetTrick, submitMatchAttempt, forfeitExpiredTurn } from "../services/games";
import { uploadVideo, type UploadProgress as UploadProgressData } from "../services/storage";
import type { UserProfile } from "../services/users";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { captureException } from "../lib/sentry";
import { sendNudge, canNudge } from "../services/nudge";
import { Btn } from "../components/ui/Btn";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { LetterDisplay } from "../components/LetterDisplay";
import { Timer } from "../components/Timer";
import { VideoRecorder } from "../components/VideoRecorder";
import { UploadProgress } from "../components/UploadProgress";
import { TurnHistoryViewer } from "../components/TurnHistoryViewer";
import { HourglassIcon } from "../components/icons";

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
  const [nudgeStatus, setNudgeStatus] = useState<"idle" | "pending" | "sent" | "error">(() =>
    canNudge(game.id) ? "idle" : "sent",
  );
  const [nudgeError, setNudgeError] = useState("");

  // Re-check nudge cooldown periodically so the button re-enables after 4 hours
  useEffect(() => {
    const id = window.setInterval(() => {
      if (canNudge(game.id)) {
        setNudgeStatus((prev) => (prev === "sent" ? "idle" : prev));
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [game.id]);

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
  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;

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
        await setTrick(game.id, trickNameRef.current.trim(), videoUrl);
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

  // Submit match attempt with self-judged result (landed/missed)
  const matchSubmittedRef = useRef(false);
  const submitMatchWithCall = useCallback(
    async (landed: boolean) => {
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
        await submitMatchAttempt(game.id, videoUrl, landed);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to submit attempt");
        setUploadProgress(null);
        matchSubmittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [game.id, game.turnNumber, videoBlob],
  );

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const deadline = game.turnDeadline?.toMillis?.() || Date.now() + 86400000;

  // ── Waiting screen (not your turn) ──
  if (!isSetter && !isMatcher) {
    const nudgeAvailable = nudgeStatus === "idle";
    return (
      <div className="min-h-dvh bg-[#0A0A0A]/80 flex flex-col items-center px-6 py-8 overflow-y-auto">
        <div className="text-center w-full max-w-sm animate-fade-in">
          <div className="flex justify-center gap-5 mb-4">
            <LetterDisplay count={myLetters} name={`@${profile.username}`} active={false} />
            <div className="flex items-center font-display text-2xl text-[#555]">VS</div>
            <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={false} />
          </div>

          <div className="flex justify-center mb-4">
            <HourglassIcon size={48} className="text-[#555]" />
          </div>
          <h2 className="font-display text-3xl text-white mb-2">Waiting on @{opponentName}</h2>
          <p className="font-body text-sm text-[#888] mb-2">
            {game.phase === "setting"
              ? "They're setting a trick for you to match."
              : "They're attempting to match your trick."}
          </p>
          <Timer deadline={deadline} />

          {game.phase === "matching" && (
            <div className="mt-6 w-full">
              <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
                Your Trick: {game.currentTrickName || "Trick"}
              </p>
              {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
                <video
                  src={game.currentTrickVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`Video of ${game.currentTrickName || "trick"} you set`}
                  className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
                />
              ) : (
                <p className="font-body text-sm text-[#555] text-center py-4">No video recorded</p>
              )}
            </div>
          )}

          {(game.turnHistory?.length ?? 0) > 0 && (
            <div className="mt-6 text-left w-full">
              <TurnHistoryViewer turns={game.turnHistory!} currentUserUid={profile.uid} defaultExpanded />
            </div>
          )}

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
                <p className="font-body text-xs text-[#666] mt-2 text-center">Nudge available every hour</p>
              )}
            </div>
          )}

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

        {isSetter ? (
          <div className="text-center mb-5 rounded-xl border bg-[rgba(255,107,0,0.06)] border-brand-orange">
            <label
              htmlFor="trickNameInput"
              className="font-display text-[11px] tracking-[0.2em] text-brand-orange block pt-3"
            >
              TRICK NAME
            </label>
            <input
              id="trickNameInput"
              type="text"
              value={trickName}
              onChange={(e) => setTrickName(e.target.value)}
              placeholder="Name your trick"
              maxLength={60}
              disabled={videoRecorded}
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-transparent text-center font-display text-xl tracking-wider text-brand-orange py-2 px-5 outline-none placeholder:text-brand-orange/60 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            {!trimmedTrickName && <p className="font-body text-xs text-[#777] pb-1">Name your trick</p>}
            {trimmedTrickName && (
              <p className="font-body text-xs text-brand-orange/80 pb-1">Set your {trimmedTrickName}</p>
            )}
            {!showRecorder && (
              <span className="text-xs text-[#777] pb-2 block">Name your trick to start recording</span>
            )}
          </div>
        ) : (
          <div className="text-center py-3 px-5 mb-5 rounded-xl border bg-[rgba(0,230,118,0.06)] border-brand-green">
            <span className="font-display text-xl tracking-wider text-brand-green">
              Match @{game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username}&apos;s{" "}
              {game.currentTrickName || "trick"}
            </span>
          </div>
        )}

        {isMatcher && (
          <div className="mb-5">
            <p className="font-display text-sm tracking-wider text-brand-orange mb-2">@{setterUsername}&apos;s TRICK</p>
            {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
              <video
                src={game.currentTrickVideoUrl}
                controls
                playsInline
                preload="metadata"
                aria-label={`Video of ${game.currentTrickName || "trick"} set by ${setterUsername}`}
                className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
              />
            ) : (
              <p className="font-body text-sm text-[#555] text-center py-4">
                No video recorded — just match the trick!
              </p>
            )}
          </div>
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

        {isMatcher && videoRecorded && !submitting && !error && (
          <div className="mt-5" role="group" aria-label="Did you land the trick?">
            {uploadProgress ? (
              <UploadProgress progress={uploadProgress} />
            ) : (
              <>
                <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
                <div className="flex gap-3">
                  <Btn onClick={() => submitMatchWithCall(true)} variant="success" disabled={submitting}>
                    ✓ Landed
                  </Btn>
                  <Btn onClick={() => submitMatchWithCall(false)} variant="danger" disabled={submitting}>
                    ✗ Missed
                  </Btn>
                </div>
              </>
            )}
          </div>
        )}
        {isMatcher && submitting && !uploadProgress && (
          <div className="mt-5 text-center">
            <span className="font-display text-lg text-brand-green tracking-wider animate-pulse">Submitting...</span>
          </div>
        )}
        {isMatcher && !submitting && error && videoRecorded && (
          <div className="mt-5">
            <Btn onClick={() => submitMatchWithCall(true)} variant="secondary">
              Retry
            </Btn>
          </div>
        )}

        {(game.turnHistory?.length ?? 0) > 0 && (
          <TurnHistoryViewer turns={game.turnHistory!} currentUserUid={profile.uid} />
        )}
      </div>
    </div>
  );
}
