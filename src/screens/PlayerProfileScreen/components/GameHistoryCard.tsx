import { useCallback, useEffect, useRef, useState } from "react";
import type { GameDoc } from "../../../services/games";
import { LETTERS } from "../../../utils/helpers";
import { trackEvent } from "../../../services/analytics";
import { TurnHistoryViewer } from "../../../components/TurnHistoryViewer";
import { GameReplay } from "../../../components/GameReplay";
import { Btn } from "../../../components/ui/Btn";
import { ChevronRightIcon } from "../../../components/icons";
import { LetterScore } from "./LetterScore";

function formatDate(ts: { toMillis?: () => number } | null | undefined): string {
  if (!ts || typeof ts.toMillis !== "function") return "";
  const d = new Date(ts.toMillis());
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function opponentName(g: GameDoc, uid: string): string {
  return g.player1Uid === uid ? g.player2Username : g.player1Username;
}

function playerLetterCount(g: GameDoc, uid: string): number {
  return g.player1Uid === uid ? g.p1Letters : g.p2Letters;
}

function opponentLetterCount(g: GameDoc, uid: string): number {
  return g.player1Uid === uid ? g.p2Letters : g.p1Letters;
}

interface Props {
  game: GameDoc;
  profileUid: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  onOpenGame: (g: GameDoc) => void;
}

export function GameHistoryCard({ game, profileUid, expanded, onToggle, onOpenGame }: Props) {
  const won = game.winner === profileUid;
  const hasTurns = (game.turnHistory?.length ?? 0) > 0;
  const [shareLabel, setShareLabel] = useState("Share Game");
  const shareLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (shareLabelTimerRef.current) clearTimeout(shareLabelTimerRef.current);
    };
  }, []);

  const handleShareGame = useCallback(async () => {
    const turns = game.turnHistory ?? [];
    const p1Name = game.player1Username;
    const p2Name = game.player2Username;
    const lines = ["SkateHubba Game Recap", `@${p1Name} vs @${p2Name}`, ""];

    for (const t of turns) {
      const outcome = t.landed ? `@${t.matcherUsername} landed` : `@${t.matcherUsername} missed`;
      lines.push(`Round ${t.turnNumber}: ${t.trickName} - Set by @${t.setterUsername}, ${outcome}`);
    }

    lines.push("");
    const p1Score = game.p1Letters > 0 ? LETTERS.slice(0, game.p1Letters).join(".") + "." : "-";
    const p2Score = game.p2Letters > 0 ? LETTERS.slice(0, game.p2Letters).join(".") + "." : "-";
    lines.push(`Final: @${p1Name} ${p1Score} | @${p2Name} ${p2Score}`);

    const winnerName = game.winner === game.player1Uid ? p1Name : p2Name;
    lines.push(game.status === "forfeit" ? `@${winnerName} wins by forfeit!` : `@${winnerName} wins!`);

    const text = lines.join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ text });
        trackEvent("game_shared", { context: "archive" });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      setShareLabel("Copied!");
      trackEvent("game_shared", { context: "archive", method: "clipboard" });
      shareLabelTimerRef.current = setTimeout(() => setShareLabel("Share Game"), 2000);
    } catch {
      setShareLabel("Copy failed");
      shareLabelTimerRef.current = setTimeout(() => setShareLabel("Share Game"), 2000);
    }
  }, [game]);

  return (
    <div
      className={`rounded-2xl overflow-hidden transition-all duration-300 ${
        expanded ? "glass-card border-brand-orange/25 shadow-glow-sm" : "glass-card"
      }`}
    >
      <button
        type="button"
        onClick={() => onToggle(game.id)}
        aria-expanded={expanded}
        className="w-full text-left p-4 flex items-center justify-between transition-colors hover:bg-[rgba(255,255,255,0.02)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-display text-[17px] text-white leading-none truncate">
              vs @{opponentName(game, profileUid)}
            </span>
            <span
              className={`px-2 py-0.5 rounded font-display text-[10px] tracking-wider leading-none shrink-0 ${
                won ? "bg-[rgba(0,230,118,0.15)] text-brand-green" : "bg-[rgba(255,61,0,0.15)] text-brand-red"
              }`}
            >
              {won ? "WIN" : "LOSS"}
            </span>
            {game.status === "forfeit" && <span className="font-body text-[10px] text-subtle shrink-0">forfeit</span>}
          </div>
          <div className="flex items-center gap-3">
            <LetterScore count={playerLetterCount(game, profileUid)} label="You" />
            <span className="font-body text-[10px] text-[#444]">vs</span>
            <LetterScore count={opponentLetterCount(game, profileUid)} label="Them" />
            {game.updatedAt && (
              <>
                <span className="text-[#2E2E2E]" aria-hidden="true">
                  ·
                </span>
                <span className="font-body text-[10px] text-subtle">{formatDate(game.updatedAt)}</span>
              </>
            )}
          </div>
        </div>
        <ChevronRightIcon
          size={14}
          className={`text-subtle shrink-0 ml-3 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border animate-fade-in">
          {hasTurns ? (
            <>
              <div className="mt-4">
                <GameReplay turns={game.turnHistory!} />
              </div>
              <TurnHistoryViewer
                turns={game.turnHistory!}
                currentUserUid={profileUid}
                defaultExpanded={false}
                showDownload={true}
                showShare={true}
              />
            </>
          ) : (
            <div className="flex flex-col items-center py-6">
              <p className="font-body text-xs text-subtle">
                {game.status === "forfeit" ? "Game ended by forfeit — no clips recorded" : "No clips available"}
              </p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {hasTurns && (
              <Btn onClick={handleShareGame} variant="secondary" className="!py-2.5 !text-sm flex-1">
                {shareLabel}
              </Btn>
            )}
            <Btn onClick={() => onOpenGame(game)} variant="ghost" className="!py-2.5 !text-sm flex-1">
              View Full Recap
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
