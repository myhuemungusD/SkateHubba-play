import { useEffect, useState } from "react";
import {
  answerBlessing,
  blessingErrorMessage,
  subscribeToPendingBlessings,
  type Blessing,
} from "../../services/proBlessing";

/**
 * The "turned pro" moment. Mounted app-wide for a signed-in skater with the
 * blessing flag on. A pending blessing opens a full-screen card; accepting
 * shows the celebration (the bell notification is written server-side).
 * Declining is quiet and final for that offer.
 */
export function TurnedProGate({ uid, onTurnedPro }: { uid: string; onTurnedPro?: () => void }) {
  const [pending, setPending] = useState<Blessing | null>(null);
  const [celebrate, setCelebrate] = useState<Blessing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeToPendingBlessings(uid, (items) => setPending(items[0] ?? null)), [uid]);

  async function answer(accept: boolean): Promise<void> {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await answerBlessing(pending.id, accept);
      if (accept && status === "accepted") {
        setCelebrate(pending);
      }
      setPending(null);
    } catch (err) {
      setError(blessingErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const shown = celebrate ?? pending;
  if (!shown) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="turned-pro-title"
      data-testid={celebrate ? "turned-pro-celebration" : "blessing-offer"}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6 text-center"
    >
      <div className="w-full max-w-sm">
        <p className="pro-username font-display text-sm tracking-[0.35em]">✦ PRO</p>
        <h1 id="turned-pro-title" className="mt-3 font-display text-4xl leading-tight tracking-wide text-white">
          {celebrate ? "You're on." : `@${shown.blesserUsername} put you on as PRO`}
        </h1>
        <p className="mt-3 font-body text-sm text-white/75">
          {celebrate
            ? "Your PRO tag, pro profile and pro tools are live."
            : "They're vouching that you're pro. Nobody earns or wins pro here. It only comes from another pro."}
        </p>
        {shown.reason && <p className="mt-4 font-body text-base italic text-amber-100">&ldquo;{shown.reason}&rdquo;</p>}
        {error && (
          <p role="alert" className="mt-3 font-body text-xs text-brand-red">
            {error}
          </p>
        )}
        {celebrate ? (
          <button
            type="button"
            onClick={() => {
              setCelebrate(null);
              // Refresh after the moment: the refreshed pro profile unmounts this gate.
              onTurnedPro?.();
            }}
            className="mt-8 w-full min-h-[48px] rounded-xl bg-amber-300 font-display tracking-wider text-black"
          >
            GOT IT
          </button>
        ) : (
          <div className="mt-8 space-y-2">
            <button
              type="button"
              data-testid="blessing-accept"
              disabled={busy}
              onClick={() => void answer(true)}
              className="w-full min-h-[48px] rounded-xl bg-amber-300 font-display tracking-wider text-black disabled:opacity-50"
            >
              ACCEPT
            </button>
            <button
              type="button"
              data-testid="blessing-decline"
              disabled={busy}
              onClick={() => void answer(false)}
              className="w-full min-h-[44px] rounded-xl font-display text-sm tracking-wider text-white/60 hover:text-white"
            >
              NOT NOW
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
