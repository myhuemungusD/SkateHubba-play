import { useCallback, useEffect, useState } from "react";
import { FileClock, Scale } from "lucide-react";
import { listDisputeQueue, ruleDispute, type AdminRuling, type QueuedDispute } from "../../../services/admin.disputes";
import { hideDispute } from "../../../services/admin";
import { listAdminAudit, type AuditEntry } from "../../../services/admin.audit";

const CARD = "rounded-2xl border border-white/[0.06] bg-surface p-4 shadow-card";
const H3 = "mb-3 flex items-center gap-2 font-display text-sm tracking-[0.15em] text-white";
const BTN =
  "min-h-[36px] rounded-lg border border-white/[0.1] px-3 font-display text-sm tracking-wider text-white/80 hover:bg-surface-alt disabled:opacity-50";

const ACTION_LABELS: Record<string, string> = {
  ban: "Banned",
  unban: "Lifted ban on",
  grant_pro: "Verified pro",
  revoke_pro: "Removed pro from",
  award_badge: "Awarded badge to",
  revoke_badge: "Removed badge from",
  award_item: "Awarded item to",
  remove_item: "Removed item from",
  hide_dispute: "Hid dispute",
  delete_comment: "Deleted comment",
  rule_dispute: "Ruled on dispute",
  resolve_report: "Closed report",
  announce: "Announced",
  end_announcement: "Ended announcement",
};

export function DisputesQueueSection() {
  const [rows, setRows] = useState<QueuedDispute[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(
    () =>
      listDisputeQueue().then(setRows, () => {
        setRows([]);
        setError("Couldn't load disputes.");
      }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, fn: () => Promise<void>, fail: string) => {
    setBusy(id);
    setError("");
    try {
      await fn();
      await load();
    } catch {
      setError(fail);
    } finally {
      setBusy("");
    }
  };

  const rule = (id: string, r: AdminRuling) => act(id, () => ruleDispute(id, r), "Couldn't save that ruling.");

  return (
    <section aria-label="Disputes queue" className={CARD}>
      <h3 className={H3}>
        <Scale size={14} aria-hidden="true" /> DISPUTES QUEUE
      </h3>
      <p className="mb-2 font-body text-xs text-white/70">
        Your ruling is final and replaces the crowd vote when the voting window closes.
      </p>
      {error && (
        <p role="alert" className="mb-2 font-body text-xs text-red-300">
          {error}
        </p>
      )}
      {rows === null ? (
        <p className="font-body text-xs text-white/60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="font-body text-xs text-white/60">No open disputes.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((d) => (
            <li key={d.id} className="rounded-xl bg-surface-alt p-3 font-body text-xs">
              <p className="text-white">
                {d.trickName}: @{d.matcherUsername} says landed, @{d.setterUsername} disputes
              </p>
              <video
                src={d.matchVideoUrl}
                controls
                playsInline
                preload="none"
                aria-label={`Disputed attempt: ${d.trickName}`}
                className="my-2 aspect-video w-full rounded-lg bg-black"
              />
              <p className="text-white/70">
                Votes: {d.landVotes} land · {d.bailVotes} bail
                {d.moderationStatus === "hidden" ? " · hidden" : ""}
              </p>
              {d.adminRuling ? (
                <p className="mt-2 text-emerald-300">Ruled: {d.adminRuling.toUpperCase()}</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy === d.id}
                    onClick={() => void rule(d.id, "land")}
                  >
                    RULE LAND
                  </button>
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy === d.id}
                    onClick={() => void rule(d.id, "bail")}
                  >
                    RULE BAIL
                  </button>
                  {d.moderationStatus === "active" && (
                    <button
                      type="button"
                      className={BTN}
                      disabled={busy === d.id}
                      onClick={() => void act(d.id, () => hideDispute(d.id), "Couldn't hide that dispute.")}
                    >
                      HIDE
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AuditLogSection() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    listAdminAudit().then(
      (r) => live && setRows(r),
      () => {
        if (!live) return;
        setRows([]);
        setError("Couldn't load the audit log.");
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <section aria-label="Audit log" className={CARD}>
      <h3 className={H3}>
        <FileClock size={14} aria-hidden="true" /> AUDIT LOG
      </h3>
      {error && (
        <p role="alert" className="mb-2 font-body text-xs text-red-300">
          {error}
        </p>
      )}
      {rows === null ? (
        <p className="font-body text-xs text-white/60">Loading…</p>
      ) : rows.length === 0 ? (
        !error && <p className="font-body text-xs text-white/60">No admin actions recorded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((e) => (
            <li key={e.id} className="font-body text-xs text-white/80">
              <span className="text-white/50">{e.atMs ? new Date(e.atMs).toLocaleString() : "just now"} · </span>
              {e.adminUid} {ACTION_LABELS[e.action] ?? e.action} {e.targetId}
              {e.detail ? ` (${e.detail})` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Disputes queue + audit log (admin claim only; the Admin screen is route-guarded). */
export function AdminOpsPanel() {
  return (
    <div className="mb-6 space-y-3" data-testid="admin-ops-panel">
      <DisputesQueueSection />
      <AuditLogSection />
    </div>
  );
}
