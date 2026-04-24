import { Btn } from "../../../components/ui/Btn";
import type { GameDoc } from "../../../services/games";

interface Props {
  game: GameDoc;
  submitting: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function JudgeInviteCard({ game, submitting, onAccept, onDecline }: Props) {
  return (
    <div className="mt-5" data-testid="judge-invite-card">
      <div className="text-center py-4 px-5 mb-5 rounded-2xl border bg-brand-orange/[0.06] backdrop-blur-sm border-brand-orange/30 shadow-[0_0_20px_rgba(255,107,0,0.06)]">
        <span className="font-display text-sm tracking-wider text-brand-orange">REFEREE INVITE</span>
        <p className="font-body text-sm text-muted mt-1">
          @{game.player1Username} asked you to referee their game vs @{game.player2Username}. Accept to rule on disputes
          and &quot;Call BS&quot; claims. Declining (or no response in 24h) lets the game continue on the honor system.
        </p>
      </div>

      {!submitting && (
        <div className="flex gap-3" role="group" aria-label="Accept or decline referee invite">
          <Btn onClick={onAccept} variant="success" disabled={submitting}>
            Accept
          </Btn>
          <Btn onClick={onDecline} variant="secondary" disabled={submitting}>
            Decline
          </Btn>
        </div>
      )}
      {submitting && <p className="font-display text-sm text-brand-orange text-center animate-pulse">Submitting...</p>}
    </div>
  );
}
