/**
 * TrickLibraryPage — community trick index.
 *
 * Browse approved tricks sorted by upvotes. Users can submit new tricks
 * (video proof required). Moderators approve/reject submissions.
 */
import { useEffect, useState } from "react";
import { Book } from "lucide-react";
import { subscribeToApprovedTricks, listPendingTricks } from "../services/trickLibrary";
import type { TrickLibraryEntry } from "../types/trickLibrary";
import { TrickCard } from "../components/TrickCard";
import { isTrickLibraryEnabled } from "../lib/featureFlags";

export function TrickLibraryPage() {
  const [tricks, setTricks] = useState<TrickLibraryEntry[]>([]);
  const [pendingTricks, setPendingTricks] = useState<TrickLibraryEntry[]>([]);

  useEffect(() => {
    if (!isTrickLibraryEnabled()) return;
    const unsub = subscribeToApprovedTricks(setTricks);
    return unsub;
  }, []);

  useEffect(() => {
    if (!isTrickLibraryEnabled()) return;
    listPendingTricks().then(setPendingTricks);
  }, []);

  if (!isTrickLibraryEnabled()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-center">
          <Book size={48} className="mx-auto mb-4 text-slate-400" />
          <h1 className="text-xl font-bold text-white">Trick Library</h1>
          <p className="text-sm text-slate-400">Coming soon...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-4">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Book size={32} className="text-blue-400" />
            <h1 className="text-2xl font-bold text-white">Trick Library</h1>
          </div>
        </div>

        {pendingTricks.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-lg font-semibold text-white">Pending Moderation</h2>
            <div className="space-y-4">
              {pendingTricks.map((trick) => (
                <TrickCard key={trick.uid} trick={trick} />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {tricks.length === 0 ? (
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-8 text-center">
              <Book size={48} className="mx-auto mb-4 text-slate-400" />
              <h3 className="mb-2 text-lg font-semibold text-white">No tricks yet</h3>
              <p className="text-sm text-slate-400">Be the first to submit a trick!</p>
            </div>
          ) : (
            tricks.map((trick) => <TrickCard key={trick.uid} trick={trick} />)
          )}
        </div>
      </div>
    </div>
  );
}
