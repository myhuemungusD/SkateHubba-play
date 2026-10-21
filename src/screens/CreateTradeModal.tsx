/**
 * New-trade flow: pick your items, name the skater, then pick what you want
 * from their closet. The server takes 1-4 items per side (item-for-item
 * only, functions/src/closet/trading.rules.ts copyIdList), so an offer
 * with nothing asked for back would always be refused.
 */
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
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
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true, onClose);
  const [step, setStep] = useState<"select-items" | "find-partner" | "their-items">("select-items");
  const [myItems, setMyItems] = useState<LockerItem[]>([]);
  const [selectedMyItems, setSelectedMyItems] = useState<string[]>([]);
  const [theirItems, setTheirItems] = useState<LockerItem[]>([]);
  const [selectedTheirItems, setSelectedTheirItems] = useState<string[]>([]);
  const [recipientUid, setRecipientUid] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const items = await fetchLockerItems(currentUid);
      setMyItems(items);
    })();
  }, [currentUid]);

  const loadTheirItems = async () => {
    setLoading(true);
    setSelectedTheirItems([]);
    setTheirItems(await fetchLockerItems(recipientUid.trim()));
    setLoading(false);
    setStep("their-items");
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await proposeTrade({
        recipientUid: recipientUid.trim(),
        proposerCopyIds: selectedMyItems,
        recipientCopyIds: selectedTheirItems,
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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="New trade"
        className="bg-surface rounded-2xl border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl text-brand-orange">NEW TRADE</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-subtle hover:text-foreground text-2xl"
          >
            ×
          </button>
        </div>

        {step === "select-items" && (
          <>
            <p className="text-subtle text-sm mb-4">Select items you want to trade away:</p>
            <ItemPicker items={myItems} selected={selectedMyItems} onChange={setSelectedMyItems} />
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
                onClick={() => void loadTheirItems()}
                disabled={!recipientUid.trim() || loading}
                className="flex-1 px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90 disabled:opacity-50"
              >
                {loading ? "Loading..." : "NEXT"}
              </button>
            </div>
          </>
        )}

        {step === "their-items" && (
          <>
            <p className="text-subtle text-sm mb-4">Pick what you want from their closet:</p>
            {theirItems.length === 0 && <p className="text-faint text-sm mb-6">They have nothing to trade yet.</p>}
            <ItemPicker items={theirItems} selected={selectedTheirItems} onChange={setSelectedTheirItems} />
            <div className="flex gap-3">
              <button
                onClick={() => setStep("find-partner")}
                className="flex-1 px-6 py-3 bg-surface-alt text-foreground rounded-lg font-display hover:bg-surface"
              >
                BACK
              </button>
              <button
                onClick={handleSubmit}
                disabled={selectedTheirItems.length === 0 || loading}
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

/** Matches the server's per-side cap (functions/src/closet/economy.ts TRADE_MAX_ITEMS). */
const MAX_ITEMS_PER_SIDE = 4;

interface ItemPickerProps {
  items: LockerItem[];
  selected: string[];
  onChange: (next: string[]) => void;
}

function ItemPicker({ items, selected, onChange }: ItemPickerProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else if (selected.length < MAX_ITEMS_PER_SIDE) onChange([...selected, id]);
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => toggle(item.id)}
          className={`aspect-square rounded-lg border p-2 flex flex-col items-center justify-center ${
            selected.includes(item.id) ? "border-brand-orange bg-brand-orange/20" : "border-border"
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
  );
}
