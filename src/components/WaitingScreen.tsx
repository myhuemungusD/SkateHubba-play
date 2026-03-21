import { useState, useEffect } from "react";
import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { sendNudge, canNudge } from "../services/nudge";
import { Btn } from "./ui/Btn";
import { LetterDisplay } from "./LetterDisplay";
import { Timer } from "./Timer";
import { TurnHistoryViewer } from "./TurnHistoryViewer";
import { HourglassIcon } from "./icons";

export function WaitingScreen({ game, profile, onBack }: { game: GameDoc; profile: UserProfile; onBack: () => void }) {
  const [nudgeStatus, setNudgeStatus] = useState<"idle" | "pending" | "sent" | "error">(() =>
    canNudge(game.id) ? "idle" : "sent",
  );
  const [nudgeError, setNudgeError] = useState("");

  // Re-check nudge cooldown periodically so the button re-enables after cooldown
  useEffect(() => {
    const id = window.setInterval(() => {
      if (canNudge(game.id)) {
        setNudgeStatus((prev) => (prev === "sent" ? "idle" : prev));
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [game.id]);

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const [fallbackDeadline] = useState(() => Date.now() + 86400000);
  const deadline = game.turnDeadline?.toMillis?.() || fallbackDeadline;
  const nudgeAvailable = nudgeStatus === "idle";

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/80 flex flex-col items-center px-6 py-8 overflow-y-auto">
      <div className="text-center w-full max-w-sm animate-fade-in">
        <div className="flex justify-center gap-5 mb-4">
          <LetterDisplay count={myLetters} name={`@${profile.username}`} active={false} />
          <div className="flex items-center font-display text-2xl text-subtle">VS</div>
          <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={false} />
        </div>

        <div className="flex justify-center mb-4">
          <HourglassIcon size={48} className="text-subtle" />
        </div>
        <h2 className="font-display text-3xl text-white mb-2">Waiting on @{opponentName}</h2>
        <p className="font-body text-sm text-muted mb-2">
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
              <p className="font-body text-sm text-subtle text-center py-4">No video recorded</p>
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
              <p className="font-body text-xs text-muted mt-2 text-center">They&apos;ll get a push notification</p>
            )}
            {!nudgeAvailable && nudgeStatus !== "sent" && (
              <p className="font-body text-xs text-faint mt-2 text-center">Nudge available every hour</p>
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
