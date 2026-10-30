/**
 * Drop Day screen — weekly limited drops with server-authoritative stock.
 * Plan §4: "Drop Day is weekly. Once an item sells out, it never returns."
 */
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { isClosetDropsEnabled } from "../lib/featureFlags";
import type { CatalogItem } from "../services/closet.catalog";
import type { Drop, DropClaim, DrawEntry } from "../services/closet.drops";
import { fetchActiveDrops, fetchDropClaim, fetchDrawEntry, claimDrop, enterDraw } from "../services/closet.drops";
import { fetchCatalogItem } from "../services/closet.catalog";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";
import { ClosetGatedState, ClosetLoadErrorState, ClosetLoadingState } from "../components/ClosetScreenStates";

interface DropWithItem {
  drop: Drop;
  item: CatalogItem | null;
  claim: DropClaim | null;
  entry: DrawEntry | null;
}

/** Active drops with their item, and the viewer's claim / draw entry. */
async function loadDrops(uid: string): Promise<DropWithItem[]> {
  const activeDrops = await fetchActiveDrops();
  return Promise.all(
    activeDrops.map(async (drop) => {
      const [item, claim, entry] = await Promise.all([
        fetchCatalogItem(drop.itemDefId),
        fetchDropClaim(drop.id, uid),
        drop.isDraw ? fetchDrawEntry(drop.id, uid) : Promise.resolve(null),
      ]);
      return { drop, item, claim, entry };
    }),
  );
}

export function DropDayScreen() {
  const { user } = useAuth();
  const [drops, setDrops] = useState<DropWithItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isClosetDropsEnabled()) return;

    let stale = false;
    void (async () => {
      try {
        const enriched = await loadDrops(user.uid);
        if (!stale) {
          setDrops(enriched);
          setLoading(false);
        }
      } catch (err) {
        if (!stale) {
          setError(parseFirebaseError(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      stale = true;
    };
  }, [user]);

  const handleClaimDrop = async (dropId: string, uid: string) => {
    setActionLoading(dropId);
    try {
      await claimDrop(dropId);
      setDrops(await loadDrops(uid));
    } catch (err) {
      logger.warn("drop_claim_failed", { dropId, error: parseFirebaseError(err) });
      setError(parseFirebaseError(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleEnterDraw = async (dropId: string, uid: string) => {
    setActionLoading(dropId);
    try {
      await enterDraw(dropId);
      setDrops(await loadDrops(uid));
    } catch (err) {
      logger.warn("draw_entry_failed", { dropId, error: parseFirebaseError(err) });
      setError(parseFirebaseError(err));
    } finally {
      setActionLoading(null);
    }
  };

  if (!isClosetDropsEnabled() || !user) {
    return <ClosetGatedState message="Drop Day is in testing and not open to everyone yet." />;
  }

  if (loading) {
    return <ClosetLoadingState />;
  }

  if (error) {
    return <ClosetLoadErrorState message="Failed to load drops" />;
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-display text-2xl text-brand-orange mb-2">DROP DAY</h1>
        <p className="text-subtle text-sm mb-8">Limited items. Once they're gone, they're gone forever.</p>

        {drops.length === 0 && (
          <div className="text-center py-12">
            <p className="text-subtle">No active drops right now. Check back soon!</p>
          </div>
        )}

        <div className="grid gap-6">
          {drops.map(({ drop, item, claim, entry }) => (
            <DropCard
              key={drop.id}
              drop={drop}
              item={item}
              claim={claim}
              entry={entry}
              onClaim={() => handleClaimDrop(drop.id, user.uid)}
              onEnterDraw={() => handleEnterDraw(drop.id, user.uid)}
              actionLoading={actionLoading === drop.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface DropCardProps {
  drop: Drop;
  item: CatalogItem | null;
  claim: DropClaim | null;
  entry: DrawEntry | null;
  onClaim: () => void;
  onEnterDraw: () => void;
  actionLoading: boolean;
}

function DropCard({ drop, item, claim, entry, onClaim, onEnterDraw, actionLoading }: DropCardProps) {
  const releaseMs = drop.startsAt.getTime();
  const isLive = drop.isLive;

  const soldOut = drop.isSoldOut;
  const stockRemaining = drop.stock - drop.claimed;
  const stockPercent = drop.stock > 0 ? (drop.claimed / drop.stock) * 100 : 100;

  return (
    <div
      className="rounded-2xl border border-border bg-surface-alt overflow-hidden"
      data-testid={`drop-card-${drop.id}`}
    >
      <div className="flex flex-col md:flex-row">
        {/* Item Image */}
        <div className="w-full md:w-1/3 aspect-square bg-surface flex items-center justify-center">
          {item?.artUrl ? (
            <img src={item.artUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="text-faint text-4xl">?</div>
          )}
        </div>

        {/* Drop Info */}
        <div className="flex-1 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-display text-xl mb-1">{item?.name ?? "Mystery Item"}</h2>
              <p className="text-sm text-subtle">{drop.isDraw ? "GRAIL DRAW" : "LIMITED DROP"}</p>
            </div>
            {soldOut && (
              <div className="px-3 py-1 bg-critical/20 border border-critical rounded-lg">
                <span className="text-critical text-sm font-display tracking-wider">SOLD OUT</span>
              </div>
            )}
          </div>

          {/* Countdown or Live Badge */}
          {!isLive && (
            <div className="mb-4">
              <p className="text-sm text-subtle mb-2">Drops in:</p>
              <CountdownTimer targetMs={releaseMs} />
            </div>
          )}

          {/* Stock Indicator */}
          {isLive && !soldOut && (
            <div className="mb-4">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm text-subtle">Stock Remaining</span>
                <span className="text-sm font-display">
                  {stockRemaining} / {drop.stock}
                </span>
              </div>
              <div className="h-2 bg-surface rounded-full overflow-hidden">
                <div className="h-full bg-brand-orange transition-all" style={{ width: `${stockPercent}%` }} />
              </div>
            </div>
          )}

          {/* Action Button */}
          {isLive && !soldOut && (
            <div>
              {claim ? (
                <div className="px-4 py-3 bg-brand-green/20 border border-brand-green rounded-lg text-center">
                  <span className="text-brand-green font-display text-sm">CLAIMED — Serial #{claim.serial}</span>
                </div>
              ) : drop.isDraw ? (
                entry ? (
                  <div className="px-4 py-3 bg-blue-500/20 border border-blue-500 rounded-lg text-center">
                    <span className="text-blue-400 font-display text-sm">ENTERED — Draw closes in 24h</span>
                  </div>
                ) : (
                  <button
                    onClick={onEnterDraw}
                    disabled={actionLoading}
                    className="w-full px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90 disabled:opacity-50"
                  >
                    {actionLoading ? "Entering..." : "ENTER DRAW (FREE)"}
                  </button>
                )
              ) : (
                <button
                  onClick={onClaim}
                  disabled={actionLoading}
                  className="w-full px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90 disabled:opacity-50"
                >
                  {actionLoading ? "Claiming..." : "CLAIM NOW (FREE)"}
                </button>
              )}
            </div>
          )}

          {soldOut && <p className="text-subtle text-sm">This drop sold out. It will never return.</p>}
        </div>
      </div>
    </div>
  );
}

function CountdownTimer({ targetMs }: { targetMs: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const diff = Math.max(0, targetMs - now);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diff % (60 * 1000)) / 1000);

  return (
    <div className="flex gap-4">
      <TimeUnit value={days} label="DAYS" />
      <TimeUnit value={hours} label="HRS" />
      <TimeUnit value={minutes} label="MIN" />
      <TimeUnit value={seconds} label="SEC" />
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="px-3 py-2 bg-surface border border-border rounded-lg min-w-[3rem] text-center">
        <span className="font-display text-xl">{value.toString().padStart(2, "0")}</span>
      </div>
      <span className="text-xs text-subtle mt-1">{label}</span>
    </div>
  );
}
