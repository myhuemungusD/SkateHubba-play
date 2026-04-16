import { useState, useEffect, useCallback } from "react";
import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { sendNudge, canNudge } from "../services/nudge";
import { trackEvent } from "../services/analytics";
import { captureException } from "../lib/sentry";
import { Btn } from "./ui/Btn";
import { LetterDisplay } from "./LetterDisplay";
import { Timer } from "./Timer";
import { TurnHistoryViewer } from "./TurnHistoryViewer";
import { HourglassIcon } from "./icons";
import { ReportModal } from "./ReportModal";

function ClipShareButtons({ videoUrl, trickName }: { videoUrl: string; trickName: string }) {
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [shareStatus, setShareStatus] = useState<"idle" | "sharing" | "shared" | "failed">("idle");

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `skatehubba-${trickName.replace(/\s+/g, "-").toLowerCase()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      setSaveStatus("saved");
      trackEvent("clip_saved", { context: "waiting_screen" });
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      captureException(err, { extra: { context: "ClipShareButtons.save", videoUrl, trickName } });
      setSaveStatus("failed");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  }, [videoUrl, trickName]);

  const handleShare = useCallback(async () => {
    setShareStatus("sharing");
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();
      const file = new File([blob], `skatehubba-${trickName.replace(/\s+/g, "-").toLowerCase()}.webm`, {
        type: "video/webm",
      });
      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `SkateHubba — ${trickName}`,
          text: `Check out my ${trickName} on SkateHubba!`,
          files: [file],
        });
        trackEvent("clip_shared", { method: "native_share", context: "waiting_screen" });
      } else if (typeof navigator.share === "function") {
        const url = import.meta.env.VITE_APP_URL || window.location.origin;
        await navigator.share({
          title: `SkateHubba — ${trickName}`,
          text: `Check out my ${trickName} on SkateHubba!\n${url}`,
        });
        trackEvent("clip_shared", { method: "native_share_text", context: "waiting_screen" });
      } else {
        const url = import.meta.env.VITE_APP_URL || window.location.origin;
        const text = `Check out my ${trickName} on SkateHubba!\n${url}`;
        await navigator.clipboard.writeText(text);
        trackEvent("clip_shared", { method: "clipboard", context: "waiting_screen" });
      }
      setShareStatus("shared");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch (err) {
      captureException(err, { extra: { context: "ClipShareButtons.share", videoUrl, trickName } });
      setShareStatus("failed");
      setTimeout(() => setShareStatus("idle"), 2000);
    }
  }, [videoUrl, trickName]);

  const saveLabel = { idle: "Save Clip", saving: "Saving...", saved: "Saved!", failed: "Save failed" }[saveStatus];
  const shareLabel = { idle: "Share Clip", sharing: "Sharing...", shared: "Shared!", failed: "Share failed" }[
    shareStatus
  ];

  return (
    <div className="flex gap-2 mt-3 w-full max-w-[360px] mx-auto">
      <button
        type="button"
        onClick={handleSave}
        disabled={saveStatus === "saving"}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border font-display text-xs tracking-wider transition-colors disabled:opacity-50 ${
          saveStatus === "saved"
            ? "border-brand-green text-brand-green"
            : saveStatus === "failed"
              ? "border-brand-red text-brand-red"
              : "border-border text-[#888] hover:text-white hover:border-[#3A3A3A]"
        }`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={handleShare}
        disabled={shareStatus === "sharing"}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border font-display text-xs tracking-wider transition-colors disabled:opacity-50 ${
          shareStatus === "shared"
            ? "border-brand-green text-brand-green"
            : shareStatus === "failed"
              ? "border-brand-red text-brand-red"
              : "border-border text-[#888] hover:text-white hover:border-[#3A3A3A]"
        }`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        {shareLabel}
      </button>
    </div>
  );
}

export function WaitingScreen({ game, profile, onBack }: { game: GameDoc; profile: UserProfile; onBack: () => void }) {
  const [nudgeStatus, setNudgeStatus] = useState<"idle" | "pending" | "sent" | "error">(() =>
    canNudge(game.id, profile.uid) ? "idle" : "sent",
  );
  const [nudgeError, setNudgeError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [reported, setReported] = useState(false);

  // Re-check nudge cooldown periodically so the button re-enables after cooldown
  useEffect(() => {
    const id = window.setInterval(() => {
      if (canNudge(game.id, profile.uid)) {
        setNudgeStatus((prev) => (prev === "sent" ? "idle" : prev));
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [game.id, profile.uid]);

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const opponentIsPro = game.player1Uid === profile.uid ? game.player2IsVerifiedPro : game.player1IsVerifiedPro;
  // A judge observing (not acting) lands here between review phases. The
  // player-centric `myLetters` / `opponentName` derivations above fall back
  // to player2 / player1 for a non-player viewer, which would otherwise
  // display the wrong scores and mislabel the Nudge / Report actions. We
  // branch on this flag to render a neutral p1-vs-p2 header and suppress
  // player-only controls.
  const isJudge = !!game.judgeId && game.judgeId === profile.uid;
  // When the viewer is the judge, the "active player" is whoever currentTurn
  // points at (setter in setting phase, matcher in matching phase). Judge
  // review phases would route to GamePlayScreen's review UI, not here.
  const activePlayerUsername = game.player1Uid === game.currentTurn ? game.player1Username : game.player2Username;
  const [fallbackDeadline] = useState(() => Date.now() + 86400000);
  const deadline = game.turnDeadline?.toMillis?.() || fallbackDeadline;
  const nudgeAvailable = nudgeStatus === "idle";
  // Judge-driven phases surface a different "who are we waiting on" copy.
  const isJudgeTurn = game.phase === "disputable" || game.phase === "setReview";
  const waitingOnLabel = isJudge
    ? `@${activePlayerUsername}`
    : isJudgeTurn && game.judgeUsername
      ? `@${game.judgeUsername}`
      : `@${opponentName}`;

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/80 flex flex-col items-center px-6 py-8 overflow-y-auto">
      <div className="text-center w-full max-w-sm animate-scale-in">
        <div className="flex justify-center gap-5 mb-4">
          {isJudge ? (
            <>
              <LetterDisplay
                count={game.p1Letters}
                name={`@${game.player1Username}`}
                active={game.currentTurn === game.player1Uid}
                isVerifiedPro={game.player1IsVerifiedPro}
              />
              <div className="flex items-center font-display text-2xl text-subtle">VS</div>
              <LetterDisplay
                count={game.p2Letters}
                name={`@${game.player2Username}`}
                active={game.currentTurn === game.player2Uid}
                isVerifiedPro={game.player2IsVerifiedPro}
              />
            </>
          ) : (
            <>
              <LetterDisplay
                count={myLetters}
                name={`@${profile.username}`}
                testId={`letter-display-${profile.username}`}
                active={false}
                isVerifiedPro={profile.isVerifiedPro}
              />
              <div className="flex items-center font-display text-2xl text-subtle">VS</div>
              <LetterDisplay
                count={theirLetters}
                name={`@${opponentName}`}
                testId={`letter-display-${opponentName}`}
                active={false}
                isVerifiedPro={opponentIsPro}
              />
            </>
          )}
        </div>

        <div className="flex justify-center mb-4">
          <HourglassIcon size={48} className="text-subtle" />
        </div>
        <h2 className="font-display text-fluid-2xl text-white mb-2">Waiting on {waitingOnLabel}</h2>
        {game.judgeUsername && game.judgeStatus === "pending" && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-subtle/40 bg-white/[0.03] px-3 py-1 text-[11px] text-subtle">
            <span className="font-display tracking-wider">REFEREE PENDING</span>
            <span className="font-body">@{game.judgeUsername} hasn&apos;t responded — honor system applies</span>
          </div>
        )}
        {game.judgeUsername && game.judgeStatus === "accepted" && (
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-orange/30 bg-brand-orange/[0.06] px-3 py-1 text-[11px] text-brand-orange"
            data-testid="judge-active-badge"
          >
            <span className="font-display tracking-wider">REFEREE</span>
            <span className="font-body">@{game.judgeUsername} rules disputes</span>
          </div>
        )}
        {game.judgeUsername && game.judgeStatus === "declined" && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-subtle/40 bg-white/[0.03] px-3 py-1 text-[11px] text-subtle">
            <span className="font-display tracking-wider">NO REFEREE</span>
            <span className="font-body">Honor system — no disputes</span>
          </div>
        )}
        <p className="font-body text-sm text-muted mb-2">
          {game.phase === "disputable"
            ? game.judgeUsername
              ? `Referee is reviewing the match call.`
              : "They're reviewing your match attempt."
            : game.phase === "setReview"
              ? `Referee is ruling clean or sketchy on the set.`
              : game.phase === "setting"
                ? isJudge
                  ? `@${activePlayerUsername} is setting a trick.`
                  : "They're setting a trick for you to match."
                : isJudge
                  ? `@${activePlayerUsername} is attempting the match.`
                  : "They're attempting to match your trick."}
        </p>
        <Timer deadline={deadline} />

        {game.phase === "disputable" && (
          <div className="mt-6 w-full">
            <div className="text-center py-2 px-4 mb-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
              <span className="font-display text-xs tracking-wider text-amber-400">UNDER REVIEW</span>
              <p className="font-body text-xs text-muted mt-0.5">
                {game.judgeUsername && game.judgeStatus === "accepted"
                  ? `You claimed landed — referee @${game.judgeUsername} is ruling.`
                  : `You claimed landed — waiting for @${opponentName}'s decision.`}
              </p>
            </div>
            {game.matchVideoUrl && isFirebaseStorageUrl(game.matchVideoUrl) && (
              <>
                <p className="font-display text-sm tracking-wider text-brand-green mb-2">
                  Your Attempt: {game.currentTrickName || "Trick"}
                </p>
                <video
                  src={game.matchVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`Your attempt at ${game.currentTrickName || "trick"}`}
                  className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
                />
                <ClipShareButtons videoUrl={game.matchVideoUrl} trickName={game.currentTrickName || "trick"} />
              </>
            )}
          </div>
        )}

        {game.phase === "matching" && (
          <div className="mt-6 w-full">
            <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
              Your Trick: {game.currentTrickName || "Trick"}
            </p>
            {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
              <>
                <video
                  src={game.currentTrickVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`Video of ${game.currentTrickName || "trick"} you set`}
                  className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
                />
                <ClipShareButtons videoUrl={game.currentTrickVideoUrl} trickName={game.currentTrickName || "trick"} />
              </>
            ) : (
              <p className="font-body text-sm text-subtle text-center py-4">No video recorded</p>
            )}
          </div>
        )}

        {game.phase === "setting" &&
          (() => {
            const lastTurn = game.turnHistory
              ?.slice()
              .reverse()
              .find((t) => {
                const wasMySet = t.setterUid === profile.uid && t.setVideoUrl;
                const wasMyMatch = t.matcherUid === profile.uid && t.matchVideoUrl;
                return wasMySet || wasMyMatch;
              });
            if (!lastTurn) return null;
            const iWasTheSetter = lastTurn.setterUid === profile.uid;
            const clipUrl = iWasTheSetter ? lastTurn.setVideoUrl : lastTurn.matchVideoUrl;
            const clipLabel = iWasTheSetter ? `Your ${lastTurn.trickName}` : `Your attempt at ${lastTurn.trickName}`;
            if (!clipUrl || !isFirebaseStorageUrl(clipUrl)) return null;
            return (
              <div className="mt-6 w-full">
                <p className="font-display text-sm tracking-wider text-brand-orange mb-2">{clipLabel}</p>
                <video
                  src={clipUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={clipLabel}
                  className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
                />
                <ClipShareButtons videoUrl={clipUrl} trickName={lastTurn.trickName} />
              </div>
            );
          })()}

        {(game.turnHistory?.length ?? 0) > 0 && (
          <div className="mt-6 text-left w-full">
            <TurnHistoryViewer
              turns={game.turnHistory!}
              currentUserUid={profile.uid}
              defaultExpanded
              showDownload
              showShare
            />
          </div>
        )}

        {game.status === "active" && !isJudge && (
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
              <p className="font-body text-xs text-muted mt-2 text-center">They&apos;ll get a push notification</p>
            )}
            {!nudgeAvailable && nudgeStatus !== "sent" && (
              <p className="font-body text-xs text-faint mt-2 text-center">Nudge available every hour</p>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-2">
          <Btn onClick={onBack} variant="ghost">
            ← Back to Games
          </Btn>
          {!isJudge && (
            <button
              type="button"
              onClick={() => setShowReport(true)}
              disabled={reported}
              className="font-body text-xs text-subtle hover:text-brand-red transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {reported ? "Reported" : "Report opponent"}
            </button>
          )}
        </div>
      </div>

      {showReport && !isJudge && (
        <ReportModal
          reporterUid={profile.uid}
          reportedUid={game.player1Uid === profile.uid ? game.player2Uid : game.player1Uid}
          reportedUsername={opponentName}
          gameId={game.id}
          onClose={() => setShowReport(false)}
          onSubmitted={() => {
            setShowReport(false);
            setReported(true);
          }}
        />
      )}
    </div>
  );
}
