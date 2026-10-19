import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { MapPin } from "lucide-react";
import { useSheetFocusTrap } from "../useSheetFocusTrap";
import { useTipZone } from "../../lib/tipSignals";
import { agoLabel, subscribeWhosSkating, type SkaterActivity, type WhosSkating } from "../../services/whosSkating";
import { PresenceDot } from "./PresenceDot";

/**
 * Home's "Who's skating" sheet, like the friends list on Snap Map: who is at
 * a spot right now, then who was out in the last day. Spot names only, never
 * a location, and skaters who hid their online status never show up.
 */
export function WhosSkatingSheet({ uid, onClose }: { uid: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [list, setList] = useState<WhosSkating | null>(null);
  const [nowMs, setNowMs] = useState(Date.now);
  useSheetFocusTrap(panelRef, onClose);
  useTipZone("whosskating");

  useEffect(
    () =>
      subscribeWhosSkating(uid, (next) => {
        setList(next);
        setNowMs(Date.now());
      }),
    [uid],
  );

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whos-skating-title"
      onClick={onClose}
      data-testid="whos-skating-sheet"
    >
      <div
        ref={panelRef}
        className="glass-card w-full max-w-md max-h-[75dvh] overflow-y-auto rounded-t-2xl px-5 pt-5 pb-safe animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="whos-skating-title" className="font-display text-lg tracking-wider text-white">
            Who&apos;s skating
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close who's skating"
            className="-mr-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-3 font-body text-sm text-muted hover:text-white"
          >
            Close
          </button>
        </div>
        <p className="font-body text-xs text-muted">Spot names only. Nobody sees your exact location.</p>

        {list === null ? (
          <p className="mt-4 pb-4 font-body text-sm text-muted">Looking around…</p>
        ) : (
          <>
            <Section
              title="Skating now"
              rows={list.now}
              empty="Nobody's checked in at a spot right now."
              testId="whos-skating-now"
              render={(r) => <SpotLink r={r} label={`at ${r.spotName}`} go={go} />}
              go={go}
            />
            <Section
              title="Recently"
              rows={list.recent}
              empty="Nobody's been out in the last day."
              testId="whos-skating-recent"
              render={(r) => <SpotLink r={r} label={`${r.spotName} · ${agoLabel(r.lastAt, nowMs)}`} go={go} />}
              go={go}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  rows,
  empty,
  testId,
  render,
  go,
}: {
  title: string;
  rows: SkaterActivity[];
  empty: string;
  testId: string;
  render: (r: SkaterActivity) => React.ReactNode;
  go: (path: string) => void;
}) {
  return (
    <section className="mt-4 pb-2" aria-label={title} data-testid={testId}>
      <h3 className="font-body text-xs font-semibold uppercase tracking-wider text-[#CCC]">
        {title}
        {rows.length > 0 && <span className="ml-1.5 text-muted">{rows.length}</span>}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 font-body text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.uid} className="flex items-center justify-between gap-2 rounded-xl bg-surface-alt px-2 py-1">
              <button
                type="button"
                onClick={() => go(`/player/${r.uid}`)}
                aria-label={`Open @${r.username}'s profile`}
                className="flex min-h-[44px] min-w-0 items-center gap-2 rounded-lg px-1 text-left font-body text-sm text-white"
              >
                <PresenceDot uid={r.uid} />
                <span className="truncate">@{r.username}</span>
              </button>
              {render(r)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SpotLink({ r, label, go }: { r: SkaterActivity; label: string; go: (path: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => go(`/spots/${r.spotId}`)}
      aria-label={`Open ${r.spotName}`}
      className="flex min-h-[44px] min-w-0 shrink items-center gap-1 rounded-lg px-1 font-body text-xs text-brand-orange"
    >
      <MapPin size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
