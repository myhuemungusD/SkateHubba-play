import { useState, useRef } from "react";
import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { BG } from "../utils/helpers";
import { Btn } from "../components/ui/Btn";
import { LetterDisplay } from "../components/LetterDisplay";
import { InviteButton } from "../components/InviteButton";

export function GameOverScreen({
  game,
  profile,
  onRematch,
  onBack,
}: {
  game: GameDoc;
  profile: UserProfile;
  onRematch?: () => Promise<void>;
  onBack: () => void;
}) {
  const [rematching, setRematching] = useState(false);
  const rematchingRef = useRef(false);

  const handleRematch = async () => {
    /* v8 ignore start */
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

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6"
      style={{
        background: isWinner
          ? `radial-gradient(ellipse at 50% 30%, rgba(0,230,118,0.05) 0%, transparent 60%), ${BG}`
          : `radial-gradient(ellipse at 50% 30%, rgba(255,61,0,0.05) 0%, transparent 60%), ${BG}`,
      }}
    >
      <div className="text-center max-w-sm animate-fade-in">
        <span className="text-6xl block mb-4">{isWinner ? "🏆" : "💀"}</span>
        <h1 className={`font-display text-5xl mb-2 ${isWinner ? "text-brand-green" : "text-brand-red"}`}>
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

        <div className="flex justify-center gap-5 mb-10">
          <LetterDisplay count={myLetters} name={`@${profile.username}`} active={isWinner} />
          <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={!isWinner} />
        </div>

        <div className="flex flex-col gap-3 w-full">
          <Btn onClick={handleRematch} disabled={rematching || !onRematch}>
            {rematching ? "Starting..." : !onRematch ? "Verify email to rematch" : "🔥 Rematch"}
          </Btn>
          <InviteButton username={profile.username} />
          <Btn onClick={onBack} variant="ghost">
            Back to Lobby
          </Btn>
        </div>
      </div>
    </div>
  );
}
