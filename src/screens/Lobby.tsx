import { useState } from "react";
import type { UserProfile } from "../services/users";
import type { GameDoc } from "../services/games";
import { LETTERS } from "../utils/helpers";
import { Btn } from "../components/ui/Btn";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { InviteButton } from "../components/InviteButton";
import { VerifyEmailBanner } from "../components/VerifyEmailBanner";

export function Lobby({
  profile,
  games,
  onChallenge,
  onOpenGame,
  onSignOut,
  onDeleteAccount,
  user,
}: {
  profile: UserProfile;
  games: GameDoc[];
  onChallenge: () => void;
  onOpenGame: (g: GameDoc) => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  user: { emailVerified?: boolean } | null;
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const active = games.filter((g) => g.status === "active");
  const done = games.filter((g) => g.status !== "active");

  const opponent = (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Username : g.player1Username);

  const isMyTurn = (g: GameDoc) => g.currentTurn === profile.uid;

  const myLetters = (g: GameDoc) => (g.player1Uid === profile.uid ? g.p1Letters : g.p2Letters);
  const theirLetters = (g: GameDoc) => (g.player1Uid === profile.uid ? g.p2Letters : g.p1Letters);

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/80 pb-24">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex justify-between items-center border-b border-border">
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">SKATEHUBBA™</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
              <span className="font-display text-[11px] text-brand-orange leading-none">
                {profile.username[0].toUpperCase()}
              </span>
            </div>
            <span className="font-body text-xs text-[#555]">@{profile.username}</span>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="font-body text-xs text-[#555] hover:text-white transition-colors duration-200 px-2.5 py-1.5 rounded-lg border border-border hover:border-[#3A3A3A]"
          >
            Sign Out
          </button>
        </div>
      </div>

      <VerifyEmailBanner emailVerified={user?.emailVerified ?? false} />

      <div className="px-5 pt-7 max-w-lg mx-auto">
        {/* Page header */}
        <div className="mb-7">
          <h1 className="font-display text-[44px] leading-none text-white tracking-wide">Your Games</h1>
          {games.length > 0 && (
            <p className="font-body text-xs text-[#555] mt-1.5">
              {active.length > 0 ? `${active.length} active` : "No active games"}
              {done.length > 0 ? ` · ${done.length} completed` : ""}
            </p>
          )}
        </div>

        {/* Primary CTA — Challenge */}
        <button
          type="button"
          onClick={user?.emailVerified ? onChallenge : undefined}
          disabled={!user?.emailVerified}
          className={`w-full flex items-center justify-center gap-2.5 rounded-xl py-[15px] mb-1 font-display tracking-wider text-xl transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${user?.emailVerified ? "bg-brand-orange text-white active:scale-[0.98] hover:bg-[#FF7A1A]" : "bg-brand-orange/40 text-white/60 cursor-not-allowed"}`}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="4.5" />
            <line x1="12" y1="19.5" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4.5" y2="12" />
            <line x1="19.5" y1="12" x2="22" y2="12" />
          </svg>
          Challenge Someone
        </button>
        {!user?.emailVerified && (
          <p className="text-[11px] text-[#888] text-center mb-2 font-body">Verify your email to start challenging</p>
        )}

        <InviteButton username={profile.username} className="mb-8" />

        {/* Active games */}
        {active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-[#444]">ACTIVE</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-[#555] leading-none tabular-nums">
                {active.length}
              </span>
            </div>
            <div className="space-y-2">
              {active.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => onOpenGame(g)}
                  className={`relative flex items-center justify-between p-4 rounded-2xl bg-surface cursor-pointer transition-all duration-200 overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange text-left w-full
                    ${
                      isMyTurn(g)
                        ? "border border-[rgba(255,107,0,0.35)] shadow-[0_0_28px_rgba(255,107,0,0.07)]"
                        : "border border-border hover:border-[#3A3A3A]"
                    }`}
                >
                  {isMyTurn(g) && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand-orange rounded-l-2xl"
                      aria-hidden="true"
                    />
                  )}
                  <div className="pl-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-display text-[19px] text-white leading-none">vs @{opponent(g)}</span>
                      {isMyTurn(g) && (
                        <span className="px-2 py-0.5 rounded bg-brand-orange font-display text-[10px] text-white tracking-wider leading-none shrink-0">
                          PLAY
                        </span>
                      )}
                    </div>
                    <span className={`font-body text-[11px] ${isMyTurn(g) ? "text-brand-orange" : "text-[#555]"}`}>
                      {isMyTurn(g) ? "Your turn" : "Waiting on opponent"}
                    </span>
                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="flex items-center gap-1">
                        <span className="font-body text-[10px] text-[#444] uppercase tracking-wider mr-0.5">You</span>
                        {LETTERS.map((l, i) => (
                          <span
                            key={i}
                            className={`font-display text-[13px] leading-none tracking-wide ${i < myLetters(g) ? "text-brand-red" : "text-[#2E2E2E]"}`}
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                      <div className="w-px h-3 bg-border shrink-0" aria-hidden="true" />
                      <div className="flex items-center gap-1">
                        <span className="font-body text-[10px] text-[#444] uppercase tracking-wider mr-0.5">Them</span>
                        {LETTERS.map((l, i) => (
                          <span
                            key={i}
                            className={`font-display text-[13px] leading-none tracking-wide ${i < theirLetters(g) ? "text-brand-red" : "text-[#2E2E2E]"}`}
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <svg
                    className={`shrink-0 ml-3 ${isMyTurn(g) ? "text-brand-orange" : "text-[#2E2E2E]"}`}
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Completed games */}
        {done.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-[#444]">COMPLETED</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-[#555] leading-none tabular-nums">
                {done.length}
              </span>
            </div>
            <div className="space-y-2">
              {done.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => onOpenGame(g)}
                  className="flex items-center justify-between p-4 rounded-2xl bg-surface border border-border cursor-pointer transition-all duration-200 hover:border-[#3A3A3A] opacity-60 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange text-left w-full"
                >
                  <div>
                    <span className="font-display text-[19px] text-white leading-none block mb-1">
                      vs @{opponent(g)}
                    </span>
                    <span
                      className={`font-body text-[11px] ${g.winner === profile.uid ? "text-brand-green" : "text-brand-red"}`}
                    >
                      {g.winner === profile.uid ? "You won" : "You lost"}
                      {g.status === "forfeit" ? " · forfeit" : ""}
                    </span>
                  </div>
                  <svg
                    className="text-[#2E2E2E] shrink-0"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {games.length === 0 && (
          <div className="flex flex-col items-center py-14 border border-dashed border-border rounded-2xl mb-6">
            <svg
              className="text-[#2E2E2E] mb-4"
              width="38"
              height="38"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="7.5" cy="17.5" r="2.5" />
              <circle cx="17.5" cy="17.5" r="2.5" />
              <path d="M2 7h1.5l2.1 7.5h10.8l2.1-6H7.5" />
            </svg>
            <p className="font-body text-sm text-[#555]">No games yet.</p>
            <p className="font-body text-xs text-[#333] mt-1">Challenge someone to get started.</p>
          </div>
        )}

        {/* Coming Soon */}
        <div className="p-5 rounded-2xl border border-border bg-surface">
          <h3 className="font-display text-[10px] tracking-[0.25em] text-[#3A3A3A] mb-4">COMING SOON</h3>
          <div>
            {["Spot Map & Discovery", "Trick Clips Feed", "Leaderboards", "Crew Challenges"].map((f, i) => (
              <div key={f} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <span className="font-display text-[10px] text-[#2E2E2E] w-4 leading-none tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-body text-sm text-[#555]">{f}</span>
                </div>
                <svg
                  className="text-[#2A2A2A]"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            ))}
          </div>
        </div>

        {/* Delete Account */}
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => setShowDeleteModal(true)}
            className="font-body text-xs text-[#555] underline underline-offset-2 hover:text-brand-red transition-colors"
          >
            Delete Account
          </button>
        </div>
      </div>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          onClick={() => {
            if (!deleting) setShowDeleteModal(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !deleting) setShowDeleteModal(false);
          }}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-modal-title" className="font-display text-xl text-white mb-2">
              Delete Account?
            </h3>
            <p className="font-body text-sm text-[#888] mb-4">
              This permanently deletes your profile and sign-in credentials. Your game history is retained for your
              opponents.
              <strong className="text-brand-red"> This cannot be undone.</strong>
            </p>
            {deleteError && <ErrorBanner message={deleteError} onDismiss={() => setDeleteError("")} />}
            <div className="flex gap-3">
              <Btn
                onClick={() => {
                  setDeleteError("");
                  setShowDeleteModal(false);
                }}
                variant="secondary"
                disabled={deleting}
              >
                Cancel
              </Btn>
              <Btn
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError("");
                  try {
                    await onDeleteAccount();
                  } catch (err: unknown) {
                    setDeleteError(err instanceof Error ? err.message : "Deletion failed — try again");
                    setDeleting(false);
                  }
                }}
                variant="danger"
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Forever"}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
