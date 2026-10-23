/**
 * Trading screen — item-for-item trades with Steam-style holds and fraud protection.
 * Plan §6: "Trade system with holds (7 days for items, 3 days for new accounts)."
 */
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { isClosetTradingEnabled } from "../lib/featureFlags";
import type { Trade, TradeStatus } from "../services/closet.trading";
import { fetchUserTrades, respondTrade, confirmTrade } from "../services/closet.trading";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";
import { CreateTradeModal } from "./CreateTradeModal";

export function TradingScreen() {
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TradeStatus | "all">("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!user || !isClosetTradingEnabled()) return;

    let stale = false;
    void (async () => {
      try {
        const allTrades = await fetchUserTrades(user.uid, filter === "all" ? undefined : filter);
        if (!stale) {
          setTrades(allTrades);
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
  }, [user, filter, refreshKey]);

  if (!isClosetTradingEnabled() || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <p className="text-subtle">Trading is in testing and not open to everyone yet.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-orange" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-4">
        <div className="text-center">
          <p className="text-critical mb-4">Failed to load trades</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-brand-orange text-surface-dark rounded-lg font-display"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl text-brand-orange mb-2">TRADING</h1>
            <p className="text-subtle text-sm">Item-for-item trades with anti-fraud protection</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90"
          >
            NEW TRADE
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {(["all", "proposed", "accepted", "declined", "canceled", "held", "complete"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-display text-sm whitespace-nowrap ${
                filter === status
                  ? "bg-brand-orange text-surface-dark"
                  : "bg-surface-alt text-subtle hover:text-foreground"
              }`}
            >
              {status.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Trades List */}
        {trades.length === 0 && (
          <div className="text-center py-12">
            <p className="text-subtle">No trades yet. Start one to swap items with other skaters!</p>
          </div>
        )}

        <div className="grid gap-4">
          {trades.map((trade) => (
            <TradeCard
              key={trade.id}
              trade={trade}
              currentUid={user.uid}
              onRefresh={() => setRefreshKey((k) => k + 1)}
            />
          ))}
        </div>

        {showCreateModal && <CreateTradeModal onClose={() => setShowCreateModal(false)} currentUid={user.uid} />}
      </div>
    </div>
  );
}

interface TradeCardProps {
  trade: Trade;
  currentUid: string;
  onRefresh: () => void;
}

function TradeCard({ trade, currentUid, onRefresh }: TradeCardProps) {
  const [actionLoading, setActionLoading] = useState(false);
  const isProposer = trade.proposerUid === currentUid;
  const otherPartyUid = isProposer ? trade.recipientUid : trade.proposerUid;

  const handleAccept = async () => {
    setActionLoading(true);
    try {
      await respondTrade({ tradeId: trade.id, response: "accept" });
      onRefresh();
    } catch (err) {
      logger.warn("trade_accept_failed", { tradeId: trade.id, error: parseFirebaseError(err) });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    setActionLoading(true);
    try {
      await respondTrade({ tradeId: trade.id, response: "decline" });
      onRefresh();
    } catch (err) {
      logger.warn("trade_reject_failed", { tradeId: trade.id, error: parseFirebaseError(err) });
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirm = async () => {
    setActionLoading(true);
    try {
      await confirmTrade(trade.id);
      onRefresh();
    } catch (err) {
      logger.warn("trade_confirm_failed", { tradeId: trade.id, error: parseFirebaseError(err) });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-alt p-6" data-testid={`trade-card-${trade.id}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-display text-lg">
            {isProposer
              ? `Trade with user ${otherPartyUid.slice(0, 8)}`
              : `Trade from user ${otherPartyUid.slice(0, 8)}`}
          </h3>
          <p className="text-sm text-subtle">
            {new Date(trade.proposedAt).toLocaleDateString()} · {trade.status.toUpperCase()}
          </p>
        </div>
        <TradeStatusBadge status={trade.status} />
      </div>

      {/* Trade Note */}
      {trade.note && (
        <div className="mb-4 px-4 py-3 bg-surface border border-border rounded-lg">
          <p className="text-sm text-subtle">{trade.note}</p>
        </div>
      )}

      {/* Items Swap Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-subtle mb-2 uppercase">{isProposer ? "You Give" : "They Give"}</p>
          <div className="space-y-2">
            {trade.proposerItems.map((item, i) => (
              <div key={i} className="px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                {item.name}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-subtle mb-2 uppercase">{isProposer ? "You Get" : "They Get"}</p>
          <div className="space-y-2">
            {trade.recipientItems.map((item, i) => (
              <div key={i} className="px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                {item.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hold: the server swaps the items itself when the hold ends (releaseTradeHolds, hourly). */}
      {trade.status === "held" && trade.holdUntil && (
        <div className="mb-4 px-4 py-3 bg-blue-500/20 border border-blue-500 rounded-lg">
          <p className="text-blue-400 text-sm">
            🔒 <strong>Trade Hold:</strong> Items swap on {new Date(trade.holdUntil).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Actions */}
      {trade.status === "proposed" && !isProposer && (
        <div className="flex gap-3">
          <button
            onClick={handleAccept}
            disabled={actionLoading}
            className="flex-1 px-6 py-3 bg-brand-green text-surface-dark rounded-lg font-display hover:bg-brand-green/90 disabled:opacity-50"
          >
            {actionLoading ? "..." : "ACCEPT"}
          </button>
          <button
            onClick={handleReject}
            disabled={actionLoading}
            className="flex-1 px-6 py-3 bg-critical text-surface-dark rounded-lg font-display hover:bg-critical/90 disabled:opacity-50"
          >
            {actionLoading ? "..." : "DECLINE"}
          </button>
        </div>
      )}

      {/* After the recipient accepts, both sides confirm; the second confirm swaps (or starts a hold). */}
      {trade.status === "accepted" && !trade.confirmedBy.includes(currentUid) && (
        <button
          onClick={handleConfirm}
          disabled={actionLoading}
          className="w-full px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90 disabled:opacity-50"
        >
          {actionLoading ? "Confirming..." : "CONFIRM TRADE"}
        </button>
      )}
      {trade.status === "accepted" && trade.confirmedBy.includes(currentUid) && (
        <p className="text-sm text-subtle">Waiting for the other skater to confirm.</p>
      )}
    </div>
  );
}

function TradeStatusBadge({ status }: { status: TradeStatus }) {
  const colors: Record<TradeStatus, string> = {
    proposed: "bg-amber-500/20 border-amber-500 text-amber-400",
    accepted: "bg-blue-500/20 border-blue-500 text-blue-400",
    complete: "bg-brand-green/20 border-brand-green text-brand-green",
    declined: "bg-critical/20 border-critical text-critical",
    canceled: "bg-subtle/20 border-subtle text-subtle",
    held: "bg-amber-500/20 border-amber-500 text-amber-400",
  };

  return (
    <div className={`px-3 py-1 border rounded-lg ${colors[status]}`}>
      <span className="text-sm font-display tracking-wider">{status.toUpperCase()}</span>
    </div>
  );
}
