import { useState, useRef, useCallback } from "react";
import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { LETTERS } from "../utils/helpers";

import { Btn } from "../components/ui/Btn";
import { LetterDisplay } from "../components/LetterDisplay";
import { InviteButton } from "../components/InviteButton";
import { TurnHistoryViewer } from "../components/TurnHistoryViewer";
import { GameReplay } from "../components/GameReplay";
import { TrophyIcon, SkullIcon } from "../components/icons";
import { ReportModal } from "../components/ReportModal";

export function GameOverScreen({
  game,
  profile,
  onRematch,
  onBack,
  onViewPlayer,
}: {
  game: GameDoc;
  profile: UserProfile;
  onRematch?: () => Promise<void>;
  onBack: () => void;
  onViewPlayer?: (uid: string) => void;
}) {
  const [rematching, setRematching] = useState(false);
  const rematchingRef = useRef(false);

  const handleRematch = async () => {
    /* v8 ignore start -- double-submit guard; rematch button disabled while in-flight */
    if (!onRematch || rematchingRef.current) return;
    /* v8 ignore stop */
    rematchingRef.current = true;
    setRematching(true);
    try {
      await onRematch();
    } finally {
      rematchingRef.current = false;
      setRematching(false);
    }
  };

  const isWinner = game.winner === profile.uid;
  const isForfeit = game.status === "forfeit";
  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const myUsername = profile.username;

  const opponentUid = game.player1Uid === profile.uid ? game.player2Uid : game.player1Uid;

  const [shareLabel, setShareLabel] = useState("Share Game Recap");
  const [showReport, setShowReport] = useState(false);
  const [reported, setReported] = useState(false);

  const handleShareGame = useCallback(async () => {
    const turns = game.turnHistory ?? [];
    const lines = ["SkateHubba Game Recap", `@${myUsername} vs @${opponentName}`, ""];

    for (const t of turns) {
      const outcome = t.landed ? `@${t.matcherUsername} landed` : `@${t.matcherUsername} missed`;
      lines.push(`Round ${t.turnNumber}: ${t.trickName} - Set by @${t.setterUsername}, ${outcome}`);
    }

    lines.push("");
    const p1Name = game.player1Username;
    const p2Name = game.player2Username;
    const p1Score = game.p1Letters > 0 ? LETTERS.slice(0, game.p1Letters).join(".") + "." : "-";
    const p2Score = game.p2Letters > 0 ? LETTERS.slice(0, game.p2Letters).join(".") + "." : "-";
    lines.push(`Final: @${p1Name} ${p1Score} | @${p2Name} ${p2Score}`);

    const winnerName = game.winner === game.player1Uid ? p1Name : p2Name;
    lines.push(isForfeit ? `@${winnerName} wins by forfeit!` : `@${winnerName} wins!`);

    const text = lines.join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      setShareLabel("Copied!");
      setTimeout(() => setShareLabel("Share Game Recap"), 2000);
    } catch {
      // Clipboard not available
    }
  }, [game, myUsername, opponentName, isForfeit]);

  const hasTurns = (game.turnHistory?.length ?? 0) > 0;

  return (
    <div
      className="min-h-dvh flex flex-col items-center px-6 py-10 overflow-y-auto"
      style={{
        background: isWinner
          ? "radial-gradient(ellipse at 50% 20%, rgba(0,230,118,0.12) 0%, transparent 50%), radial-gradient(ellipse at 30% 60%, rgba(0,230,118,0.04) 0%, transparent 50%), rgba(10,10,10,0.85)"
          : "radial-gradient(ellipse at 50% 20%, rgba(255,61,0,0.12) 0%, transparent 50%), radial-gradient(ellipse at 70% 60%, rgba(255,61,0,0.04) 0%, transparent 50%), rgba(10,10,10,0.85)",
      }}
    >
      <div className="text-center w-full max-w-md animate-scale-in">
        <div className="flex justify-center mb-4">
          {isWinner ? (
            <TrophyIcon size={56} className="text-brand-green" />
          ) : (
            <SkullIcon size={56} className="text-brand-red" />
          )}
        </div>
        <h1
          className={`font-display text-fluid-4xl mb-2 ${isWinner ? "text-brand-green drop-shadow-[0_0_20px_rgba(0,230,118,0.4)]" : "text-brand-red drop-shadow-[0_0_20px_rgba(255,61,0,0.4)]"}`}
        >
          {isWinner ? "You Win" : isForfeit ? "Forfeit" : "S.K.A.T.E."}
        </h1>
        <p className="font-body text-base text-[#888] mb-8">
          {isForfeit
            ? isWinner
              ? `@${opponentName} ran out of time.`
              : "You ran out of time."
            : isWinner
              ? `@${opponentName} spelled S.K.A.T.E.`
              : `@${opponentName} outlasted you.`}
        </p>

        {onViewPlayer && (
          <button
            type="button"
            onClick={() => onViewPlayer(opponentUid)}
            className="font-display text-sm text-brand-orange hover:text-[#FF7A1A] transition-colors mb-6 underline underline-offset-2"
          >
            View @{opponentName}&apos;s Record
          </button>
        )}

        <div className="flex justify-center gap-5 mb-6">
          <LetterDisplay count={myLetters} name={`@${profile.username}`} active={isWinner} />
          <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={!isWinner} />
        </div>

        {/* Full game replay */}
        {hasTurns && (
          <div className="w-full mb-4">
            <GameReplay turns={game.turnHistory!} />
          </div>
        )}

        {/* Game clips recap */}
        {hasTurns && (
          <div className="w-full text-left mb-6">
            <TurnHistoryViewer
              turns={game.turnHistory!}
              currentUserUid={profile.uid}
              defaultExpanded={true}
              showDownload={true}
              showShare={true}
            />
          </div>
        )}

        <div className="flex flex-col gap-3 w-full">
          {hasTurns && (
            <Btn onClick={handleShareGame} variant="secondary">
              {shareLabel}
            </Btn>
          )}
          <Btn onClick={handleRematch} disabled={rematching || !onRematch}>
            {rematching ? "Starting..." : !onRematch ? "Verify email to rematch" : "Rematch"}
          </Btn>
          <InviteButton username={profile.username} />
          <Btn onClick={onBack} variant="ghost">
            Back to Lobby
          </Btn>
          <button
            type="button"
            onClick={() => setShowReport(true)}
            disabled={reported}
            className="font-body text-xs text-subtle hover:text-brand-red transition-colors duration-300 mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {reported ? "Reported" : "Report opponent"}
          </button>
        </div>
      </div>

      {showReport && (
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
