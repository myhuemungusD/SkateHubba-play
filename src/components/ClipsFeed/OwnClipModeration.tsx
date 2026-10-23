import { useEffect, useState } from "react";
import { Link } from "react-router";
import { isClipModerationEnabled } from "../../lib/featureFlags";
import { fetchOwnClipModeration, type OwnClipModerationRow } from "../../services/clipModeration";

/**
 * The owner's own public clips that are not in the feed. Pending clips say
 * "Checking…". Renders as a row in the feed's top stack, under the header.
 * Hidden until VITE_FEATURE_CLIP_MODERATION_ENABLED is "true".
 */
export function OwnClipModeration({ uid, refreshKey }: { uid: string; refreshKey: number }) {
  const enabled = isClipModerationEnabled();
  const [rows, setRows] = useState<OwnClipModerationRow[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    fetchOwnClipModeration(uid)
      .then((next) => {
        if (!stale) setRows(next);
      })
      .catch(() => {
        if (!stale) setRows([]);
      });
    return () => {
      stale = true;
    };
  }, [enabled, uid, refreshKey]);

  if (!enabled || rows.length === 0) return null;

  return (
    <ul
      aria-label="Your clips being checked"
      className="pointer-events-auto mx-3 mt-2 max-h-[40dvh] space-y-2 overflow-y-auto"
    >
      {rows.map((row) => (
        <li key={row.id} className="rounded-2xl border border-border bg-surface px-4 py-3">
          <p className="font-body text-sm text-white">{row.statement}</p>
          <p className="font-body text-xs text-muted">{row.trickName}</p>
          {row.appealPath && (
            <Link
              to={row.appealPath}
              className="mt-1 inline-flex min-h-[44px] items-center font-body text-xs text-brand-orange"
            >
              Appeal
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
