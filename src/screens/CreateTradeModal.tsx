/** New-trade flow: pick your items, then name the skater to send the offer to. */
import { useEffect, useState } from "react";
import type { LockerItem } from "../services/locker";
import { proposeTrade } from "../services/closet.trading";
import { fetchLockerItems } from "../services/locker";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";

interface CreateTradeModalProps {
  onClose: () => void;
  currentUid: string;
}

export function CreateTradeModal({ onClose, currentUid }: CreateTradeModalProps) {
  const [step, setStep] = useState<"select-items" | "find-partner" | "confirm">("select-items");
  const [myItems, setMyItems] = useState<LockerItem[]>([]);
  const [selectedMyItems, setSelectedMyItems] = useState<string[]>([]);
  const [recipientUid, setRecipientUid] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const items = await fetchLockerItems(currentUid);
      setMyItems(items);
    })();
  }, [currentUid]);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await proposeTrade({
        recipientUid,
        proposerCopyIds: selectedMyItems,
        recipientCopyIds: [], // Partner will counter with their items
      });
      onClose();
    } catch (err) {
      logger.warn("trade_propose_failed", { error: parseFirebaseError(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl text-brand-orange">NEW TRADE</h2>
          <button onClick={onClose} className="text-subtle hover:text-foreground text-2xl">
            ×
          </button>
        </div>

        {step === "select-items" && (
          <>
            <p className="text-subtle text-sm mb-4">Select items you want to trade away:</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              {myItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() =>
                    setSelectedMyItems((prev) =>
                      prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
                    )
                  }
                  className={`aspect-square rounded-lg border p-2 flex flex-col items-center justify-center ${
                    selectedMyItems.includes(item.id) ? "border-brand-orange bg-brand-orange/20" : "border-border"
                  }`}
                >
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover rounded" />
                  ) : (
                    <div className="text-faint">?</div>
                  )}
                  <span className="text-xs mt-2 text-center truncate w-full">{item.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep("find-partner")}
              disabled={selectedMyItems.length === 0}
              className="w-full px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90 disabled:opacity-50"
            >
              NEXT ({selectedMyItems.length} items)
            </button>
          </>
        )}

        {step === "find-partner" && (
          <>
            <p className="text-subtle text-sm mb-4">Who do you want to trade with?</p>
            <input
              type="text"
              value={recipientUid}
              onChange={(e) => setRecipientUid(e.target.value)}
              placeholder="Enter user ID"
              className="w-full px-4 py-3 bg-surface-alt border border-border rounded-lg mb-6 focus:outline-none focus:border-brand-orange"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setStep("select-items")}
                className="flex-1 px-6 py-3 bg-surface-alt text-foreground rounded-lg font-display hover:bg-surface"
              >
                BACK
              </button>
              <button
                onClick={handleSubmit}
                disabled={!recipientUid || loading}
                className="flex-1 px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90 disabled:opacity-50"
              >
                {loading ? "Sending..." : "SEND OFFER"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
