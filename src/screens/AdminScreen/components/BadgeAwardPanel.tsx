import { useCallback, useEffect, useState } from "react";
import { awardAchievement, revokeAchievement } from "../../../services/admin";
import { fetchAchievements, type Achievement } from "../../../services/achievements";
import { BADGE_META } from "../../../constants/badges";
import { useNotifications } from "../../../context/NotificationContext";
import { errorMessage } from "../utils";
import { AdminTextField } from "./AdminFormFields";
import { ConfirmButton } from "./ConfirmButton";

/** The launch badge set. Ids are server-owned; this is the awardable list. */
const BADGE_IDS = Object.keys(BADGE_META);

/** Matches the grant writer's stored `reason` cap. */
const MAX_REASON = 200;

/**
 * Badge grant/revoke for one player.
 *
 * A grant is permanent-feeling to the player who earns it, so the reason is
 * mandatory here: `users/{uid}/achievements/{id}.reason` is what the profile
 * chip's tooltip shows, and an unexplained badge is indistinguishable from a
 * mis-click when someone asks about it six months later.
 *
 * Grants are immutable — the rules deny updates outright — so an already-earned
 * badge offers Revoke and nothing else. Fixing a wrong reason means revoking
 * and re-awarding, which is why no Award affordance is rendered next to an
 * earned badge: it could only ever fail.
 */
export function BadgeAwardPanel({ uid, username }: { uid: string; username: string }) {
  const { notify } = useNotifications();
  const [data, setData] = useState<{ loadedUid: string; items: Achievement[] }>({ loadedUid: "", items: [] });
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    fetchAchievements(uid)
      .then((items) => {
        if (!stale) setData({ loadedUid: uid, items });
      })
      .catch((err: unknown) => {
        if (stale) return;
        setData({ loadedUid: uid, items: [] });
        notify({ type: "error", title: "Couldn't load badges", message: errorMessage(err) });
      });
    return () => {
      stale = true;
    };
  }, [uid, notify]);

  const refresh = useCallback(async () => {
    const items = await fetchAchievements(uid);
    setData({ loadedUid: uid, items });
  }, [uid]);

  const award = async (badgeId: string): Promise<void> => {
    setActing(badgeId);
    try {
      await awardAchievement(uid, badgeId, reason.trim());
      notify({ type: "success", title: "Badge awarded", message: `${BADGE_META[badgeId].label} → @${username}` });
      setReason("");
      await refresh();
    } catch (err: unknown) {
      notify({ type: "error", title: "Award failed", message: errorMessage(err) });
    } finally {
      setActing(null);
    }
  };

  const revoke = async (badgeId: string): Promise<void> => {
    setActing(badgeId);
    try {
      await revokeAchievement(uid, badgeId);
      notify({ type: "success", title: "Badge revoked", message: `${BADGE_META[badgeId].label} → @${username}` });
      await refresh();
    } catch (err: unknown) {
      notify({ type: "error", title: "Revoke failed", message: errorMessage(err) });
    } finally {
      setActing(null);
    }
  };

  const loading = data.loadedUid !== uid;
  const earnedIds = new Set(data.items.map((item) => item.id));
  const reasonMissing = reason.trim().length === 0;

  return (
    <section aria-label="Badges" className="mb-8">
      <h2 className="mb-3 font-display text-[10px] tracking-[0.2em] text-brand-orange">BADGES</h2>

      <AdminTextField
        label="Reason"
        value={reason}
        onChange={setReason}
        placeholder="Why this badge was granted"
        maxLength={MAX_REASON}
        note={`${reason.length}/${MAX_REASON}`}
      />

      {loading ? (
        <p className="font-body text-xs text-subtle">Loading badges...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {BADGE_IDS.map((badgeId) => {
            const meta = BADGE_META[badgeId];
            const earned = earnedIds.has(badgeId);
            return (
              <li
                key={badgeId}
                data-testid={`badge-row-${badgeId}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <meta.Icon size={18} strokeWidth={1.8} className="shrink-0 text-brand-orange" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm text-white">{meta.label}</p>
                    <p className="font-body text-[11px] text-subtle">{earned ? "Earned" : meta.description}</p>
                  </div>
                </div>
                {earned ? (
                  <ConfirmButton
                    label="Revoke"
                    question={`Revoke ${meta.label} from @${username}?`}
                    confirmLabel="Revoke"
                    tone="danger"
                    loading={acting === badgeId}
                    onConfirm={() => void revoke(badgeId)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void award(badgeId)}
                    disabled={reasonMissing || acting === badgeId}
                    aria-label={`Award ${meta.label} to ${username}`}
                    className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-brand-orange/40 bg-brand-orange/[0.12] px-4 font-display text-[11px] tracking-[0.15em] text-brand-orange transition-colors active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {acting === badgeId ? "..." : "AWARD"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
