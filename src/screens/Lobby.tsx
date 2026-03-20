import { useState, useEffect } from "react";
import { type UserProfile, getPlayerDirectory } from "../services/users";
import type { FieldValue } from "firebase/firestore";
import type { GameDoc } from "../services/games";
import { LETTERS } from "../utils/helpers";
import { Btn } from "../components/ui/Btn";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { InviteButton } from "../components/InviteButton";
import { VerifyEmailBanner } from "../components/VerifyEmailBanner";
import { NotificationBell } from "../components/NotificationBell";
import { PushPermissionBanner } from "../components/PushPermissionBanner";
import { LobbyTimer } from "../components/LobbyTimer";
import { SkateboardIcon, TrophyIcon } from "../components/icons";

function relativeJoinDate(createdAt: FieldValue | null): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!createdAt || typeof (createdAt as any).toMillis !== "function") return "Joined";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const millis = (createdAt as any).toMillis() as number;
  const ms = Date.now() - millis;
  if (ms < 0) return "Just joined"; // future timestamp (clock skew)
  const hours = ms / 3_600_000;
  if (hours < 1) return "Just joined";
  if (hours < 24) return `Joined ${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Joined ${days}d ago`;
  const d = new Date(millis);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `Joined ${month} ${d.getDate()}`;
}

export function Lobby({
  profile,
  games,
  onChallenge,
  onChallengeUser,
  onOpenGame,
  onSignOut,
  onDeleteAccount,
  user,
}: {
  profile: UserProfile;
  games: GameDoc[];
  onChallenge: () => void;
  onChallengeUser: (username: string) => void;
  onOpenGame: (g: GameDoc) => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  user: { emailVerified?: boolean } | null;
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [players, setPlayers] = useState<UserProfile[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);

  useEffect(() => {
    let stale = false;
    getPlayerDirectory()
      .then((all) => {
        if (!stale) setPlayers(all.filter((p) => p.uid !== profile.uid));
      })
      .catch(() => {
        if (!stale) setPlayers([]);
      })
      .finally(() => {
        if (!stale) setPlayersLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [profile.uid]);

  const active = games.filter((g) => g.status === "active");
  const done = games.filter((g) => g.status !== "active");

  const opponent = (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Username : g.player1Username);

  const isMyTurn = (g: GameDoc) => g.currentTurn === profile.uid;

  const myLetters = (g: GameDoc) => (g.player1Uid === profile.uid ? g.p1Letters : g.p2Letters);
  const theirLetters = (g: GameDoc) => (g.player1Uid === profile.uid ? g.p2Letters : g.p1Letters);

  const turnLabel = (g: GameDoc) => {
    const trick = g.currentTrickName || "Trick";
    if (isMyTurn(g)) {
      if (g.phase === "matching") return `Match: ${trick}`;
      if (g.phase === "confirming") return "Vote on attempt";
      return "Your turn to set";
    }
    if (g.phase === "matching") return `Matching: ${trick}`;
    if (g.phase === "confirming") return "Vote on attempt";
    return "They're setting a trick";
  };

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/60 pb-24">
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
            <span className="font-body text-xs text-brand-orange">@{profile.username}</span>
          </div>
          <NotificationBell games={games} onOpenGame={onOpenGame} />
          <button
            type="button"
            onClick={onSignOut}
            className="font-body text-xs text-[#999] hover:text-white transition-colors duration-200 px-2.5 py-1.5 rounded-lg border border-border hover:border-[#3A3A3A]"
          >
            Sign Out
          </button>
        </div>
      </div>

      <VerifyEmailBanner emailVerified={user?.emailVerified ?? false} />
      <PushPermissionBanner uid={profile.uid} />

      <div className="px-5 pt-7 max-w-lg mx-auto">
        {/* Page header */}
        <div className="mb-7">
          <h1 className="font-display text-[44px] leading-none text-white tracking-wide">Your Games</h1>
          {games.length > 0 && (
            <p className="font-body text-xs text-brand-green mt-1.5">
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

        <InviteButton username={profile.username} className="mb-3" />

        {user?.emailVerified && (
          <p className="font-body text-xs text-[#999] text-center mb-8">
            No one to play?{" "}
            <button
              type="button"
              onClick={() => onChallengeUser("mikewhite")}
              className="text-brand-orange hover:text-[#FF7A1A] transition-colors underline underline-offset-2"
            >
              Challenge @mikewhite
            </button>
          </p>
        )}

        {/* Active games */}
        {active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">ACTIVE</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
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
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-body text-[11px] ${isMyTurn(g) ? "text-brand-orange" : "text-brand-green"}`}
                      >
                        {turnLabel(g)}
                      </span>
                      <LobbyTimer deadline={g.turnDeadline?.toMillis?.() ?? 0} isMyTurn={isMyTurn(g)} />
                    </div>
                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="flex items-center gap-1">
                        <span className="font-body text-[10px] text-brand-orange uppercase tracking-wider mr-0.5">
                          You
                        </span>
                        {LETTERS.map((l, i) => (
                          <span
                            key={i}
                            className={`font-display text-[13px] leading-none tracking-wide ${i < myLetters(g) ? "text-brand-red" : "text-[#666]"}`}
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                      <div className="w-px h-3 bg-border shrink-0" aria-hidden="true" />
                      <div className="flex items-center gap-1">
                        <span className="font-body text-[10px] text-brand-orange uppercase tracking-wider mr-0.5">
                          Them
                        </span>
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
                    className={`shrink-0 ml-3 ${isMyTurn(g) ? "text-brand-orange" : "text-[#666]"}`}
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

        {/* Active empty state */}
        {active.length === 0 && done.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">ACTIVE</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                0
              </span>
            </div>
            <div className="flex flex-col items-center py-8 border border-dashed border-border rounded-2xl">
              <SkateboardIcon size={24} className="mb-2 opacity-40 text-[#555]" />
              <p className="font-body text-xs text-[#666]">No active games right now</p>
              <p className="font-body text-[11px] text-[#555] mt-0.5">Challenge someone to start a new round</p>
            </div>
          </div>
        )}

        {/* Completed games */}
        {done.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">COMPLETED</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
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
                    className="text-[#666] shrink-0"
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

        {/* Completed empty state */}
        {done.length === 0 && active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">COMPLETED</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                0
              </span>
            </div>
            <div className="flex flex-col items-center py-8 border border-dashed border-border rounded-2xl">
              <TrophyIcon size={24} className="mb-2 opacity-40 text-[#555]" />
              <p className="font-body text-xs text-[#666]">No finished games yet</p>
              <p className="font-body text-[11px] text-[#555] mt-0.5">Complete a game to see your results here</p>
            </div>
          </div>
        )}

        {/* Empty state — no games at all */}
        {games.length === 0 && (
          <div className="flex flex-col items-center py-14 border border-dashed border-border rounded-2xl mb-6">
            <svg
              className="text-brand-orange mb-4"
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
            <p className="font-body text-sm text-[#999]">No games yet.</p>
            <p className="font-body text-xs text-[#777] mt-1">Challenge someone to get started.</p>
          </div>
        )}

        {/* Player Directory */}
        {playersLoading && <p className="font-body text-xs text-brand-orange text-center mb-6">Loading skaters...</p>}
        {!playersLoading && players.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">SKATERS</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                {players.length}
              </span>
            </div>
            <div className="space-y-2">
              {players.map((p) => (
                <button
                  type="button"
                  key={p.uid}
                  onClick={() => onChallengeUser(p.username)}
                  disabled={!user?.emailVerified}
                  className={`flex items-center justify-between p-4 rounded-2xl bg-surface border border-border transition-all duration-200 text-left w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${user?.emailVerified ? "cursor-pointer hover:border-[#3A3A3A]" : "cursor-not-allowed opacity-60"}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
                      <span className="font-display text-[11px] text-brand-orange leading-none">
                        {p.username[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="font-display text-base text-white block leading-none">@{p.username}</span>
                      <span className="font-body text-[11px] text-brand-green block mt-1">
                        {p.stance}
                        {p.createdAt ? ` \u00B7 ${relativeJoinDate(p.createdAt)}` : ""}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`font-display text-xs shrink-0 ml-3 ${user?.emailVerified ? "text-brand-orange" : "text-[#555]"}`}
                  >
                    Challenge &rarr;
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Coming Soon */}
        <div className="p-5 rounded-2xl border border-border bg-surface">
          <h3 className="font-display text-[10px] tracking-[0.25em] text-brand-orange mb-4">COMING SOON</h3>
          <div>
            {["Spot Map & Discovery", "Trick Clips Feed", "Crew Challenges"].map((f, i) => (
              <div key={f} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <span className="font-display text-[10px] text-brand-orange w-4 leading-none tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-body text-sm text-[#999]">{f}</span>
                </div>
                <svg
                  className="text-brand-orange"
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
            className="font-body text-xs text-[#999] underline underline-offset-2 hover:text-brand-red transition-colors"
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
