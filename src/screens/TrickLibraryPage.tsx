/**
 * Trick Library (flag VITE_FEATURE_TRICK_LIBRARY_ENABLED; testers always see it).
 *
 * Browse approved tricks and vote on them, submit a new one for review, see
 * your own submissions, and (admin-claim only) work the review queue.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  listApprovedTricks,
  listMySubmissions,
  listPendingTricks,
  moderateTrick,
  submitTrick,
} from "../services/trickLibrary";
import {
  TRICK_DESCRIPTION_MAX,
  TRICK_DIFFICULTIES,
  TRICK_NAME_MAX,
  type TrickDifficulty,
  type TrickLibraryEntry,
} from "../types/trickLibrary";
import { TrickCard } from "../components/TrickCard";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { logger } from "../services/logger";

interface Props {
  uid: string;
  emailVerified: boolean;
}

const STATUS_LABEL: Record<TrickLibraryEntry["status"], string> = {
  pending: "Waiting for review",
  approved: "In the library",
  rejected: "Not added",
};

export function TrickLibraryPage({ uid, emailVerified }: Props) {
  const { isAdmin } = useIsAdmin(uid);
  const [approved, setApproved] = useState<TrickLibraryEntry[]>([]);
  const [mine, setMine] = useState<TrickLibraryEntry[]>([]);
  const [pending, setPending] = useState<TrickLibraryEntry[]>([]);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<TrickDifficulty>("beginner");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState("");

  // Bumped after a submit or a decision to re-read the lists.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let live = true;
    Promise.all([listApprovedTricks(), listMySubmissions(uid)])
      .then(([a, m]) => {
        if (!live) return;
        setApproved(a);
        setMine(m);
        setLoadError("");
      })
      .catch((err: unknown) => {
        logger.warn("trick_library_load_failed", { error: String(err) });
        if (live) setLoadError("Couldn't load the trick library. Try again in a moment.");
      });
    return () => {
      live = false;
    };
  }, [uid, version]);

  useEffect(() => {
    if (!isAdmin) return;
    listPendingTricks()
      .then(setPending)
      .catch((err: unknown) => logger.warn("trick_queue_load_failed", { error: String(err) }));
  }, [isAdmin]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormMsg("");
    try {
      await submitTrick(uid, { name, difficulty, description });
      setName("");
      setDescription("");
      setFormMsg("Sent for review. It shows up in the library once it's approved.");
      reload();
    } catch (err) {
      setFormMsg(err instanceof Error ? err.message : "Couldn't send that. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (trickId: string, decision: "approved" | "rejected") => {
    try {
      await moderateTrick(uid, trickId, decision);
      setPending((list) => list.filter((t) => t.id !== trickId));
      reload();
    } catch (err) {
      logger.warn("trick_moderate_failed", { trickId, error: String(err) });
    }
  };

  return (
    <main id="main-content" className="mx-auto min-h-dvh max-w-[430px] px-5 pb-28 pt-safe">
      <div className="flex items-center justify-between py-4">
        <h1 className="font-display text-2xl tracking-wider text-white">Trick Library</h1>
        <Link to="/lobby" className="touch-target font-body text-sm text-muted hover:text-white">
          Back
        </Link>
      </div>

      {loadError && (
        <p role="alert" className="mb-4 font-body text-sm text-brand-red">
          {loadError}
        </p>
      )}

      <section aria-labelledby="tricks-heading" className="mb-8">
        <h2 id="tricks-heading" className="mb-3 font-display text-lg tracking-wider text-white">
          Tricks
        </h2>
        {approved.length === 0 ? (
          <p className="font-body text-sm text-dim">No tricks yet. Add the first one below.</p>
        ) : (
          <div className="space-y-3">
            {approved.map((t) => (
              <TrickCard key={t.id} trick={t} uid={uid} canVote={emailVerified} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="submit-heading" className="mb-8">
        <h2 id="submit-heading" className="mb-3 font-display text-lg tracking-wider text-white">
          Add a trick
        </h2>
        {!emailVerified ? (
          <p className="font-body text-sm text-dim">Verify your email to add tricks and vote.</p>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
            <label className="block font-body text-sm text-muted">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={TRICK_NAME_MAX}
                required
                className="mt-1 w-full rounded-xl border border-border bg-transparent px-3 py-2 text-white"
              />
            </label>
            <label className="block font-body text-sm text-muted">
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as TrickDifficulty)}
                className="mt-1 w-full rounded-xl border border-border bg-[#141414] px-3 py-2 text-white"
              >
                {TRICK_DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="block font-body text-sm text-muted">
              How to do it (optional)
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={TRICK_DESCRIPTION_MAX}
                rows={3}
                className="mt-1 w-full rounded-xl border border-border bg-transparent px-3 py-2 text-white"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="touch-target w-full rounded-2xl bg-brand-orange py-3 font-display tracking-wider text-[#1a1a1a] disabled:opacity-40"
            >
              {submitting ? "Sending…" : "Send for review"}
            </button>
            {formMsg && (
              <p role="status" className="font-body text-sm text-dim">
                {formMsg}
              </p>
            )}
          </form>
        )}
      </section>

      {mine.length > 0 && (
        <section aria-labelledby="mine-heading" className="mb-8">
          <h2 id="mine-heading" className="mb-3 font-display text-lg tracking-wider text-white">
            Your submissions
          </h2>
          <ul className="space-y-2">
            {mine.map((t) => (
              <li key={t.id} className="flex justify-between font-body text-sm">
                <span className="text-white">{t.name}</span>
                <span className="text-dim">{STATUS_LABEL[t.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && (
        <section aria-labelledby="queue-heading">
          <h2 id="queue-heading" className="mb-3 font-display text-lg tracking-wider text-white">
            Review queue
          </h2>
          {pending.length === 0 ? (
            <p className="font-body text-sm text-dim">Nothing waiting.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((t) => (
                <TrickCard
                  key={t.id}
                  trick={t}
                  uid={uid}
                  canVote={false}
                  footer={
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void decide(t.id, "approved")}
                        className="touch-target rounded-xl border border-brand-green px-3 py-1.5 font-display text-sm text-brand-green"
                      >
                        Approve {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(t.id, "rejected")}
                        className="touch-target rounded-xl border border-brand-red px-3 py-1.5 font-display text-sm text-brand-red"
                      >
                        Reject {t.name}
                      </button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
