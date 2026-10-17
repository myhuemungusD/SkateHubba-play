/**
 * Admin catalog tools — staging items, managing drops, adjusting stock.
 * Admin-only screen for managing the closet economy.
 */
import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { requireFunctions } from "../firebase";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";

interface AdminAction {
  action: "createItem" | "updateItem" | "createDrop" | "adjustStock" | "runDraw";
  params: Record<string, unknown>;
}

export function AdminCatalogTools() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [itemDefId, setItemDefId] = useState("");
  const [itemName, setItemName] = useState("");
  const [rarity, setRarity] = useState("common");
  const [slot, setSlot] = useState("deck");
  const [priceBucks, setPriceBucks] = useState("100");

  const [dropId, setDropId] = useState("");
  const [dropStock, setDropStock] = useState("250");

  const handleCreateItem = async () => {
    setLoading(true);
    setError(null);
    try {
      const fns = await requireFunctions();
      const callable = httpsCallable<AdminAction, { success: boolean }>(fns, "closetAdmin");
      await callable({
        action: "createItem",
        params: {
          itemDefId,
          item: {
            name: itemName,
            type: slot,
            slot,
            rarity,
            artUrl: `https://example.com/${itemDefId}.png`,
            layerUrls: { front: `https://example.com/${itemDefId}-front.png`, back: null },
            model3dUrl: null,
            edition: { kind: "open", supply: null, minted: 0, soldOut: false },
            source: "shop",
            priceBucks: parseInt(priceBucks, 10),
            dropId: null,
            licensed: { brand: null, licenseRef: null },
            releasedAt: new Date(),
            retiredAt: null,
          },
        },
      });
      setResult(`✅ Created item: ${itemDefId}`);
    } catch (err) {
      setError(parseFirebaseError(err));
      logger.warn("admin_create_item_failed", { error: parseFirebaseError(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDrop = async () => {
    setLoading(true);
    setError(null);
    try {
      const fns = await requireFunctions();
      const callable = httpsCallable<AdminAction, { success: boolean }>(fns, "closetAdmin");
      await callable({
        action: "createDrop",
        params: {
          dropId,
          drop: {
            itemDefId,
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            drawEntryWindowEndsAt: null,
            stock: parseInt(dropStock, 10),
            claimed: 0,
            requiresGames: 0,
            requiresAccountDays: 0,
            isLive: true,
            isSoldOut: false,
            isDraw: false,
          },
        },
      });
      setResult(`✅ Created drop: ${dropId}`);
    } catch (err) {
      setError(parseFirebaseError(err));
      logger.warn("admin_create_drop_failed", { error: parseFirebaseError(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-display text-2xl text-brand-orange mb-2">ADMIN CATALOG TOOLS</h1>
        <p className="text-subtle text-sm mb-8">Manage items, drops, and stock (admin-only)</p>

        {/* Result/Error Banner */}
        {result && (
          <div className="mb-6 px-4 py-3 bg-brand-green/20 border border-brand-green rounded-lg">
            <p className="text-brand-green text-sm">{result}</p>
          </div>
        )}
        {error && (
          <div className="mb-6 px-4 py-3 bg-critical/20 border border-critical rounded-lg">
            <p className="text-critical text-sm">Error: {error}</p>
          </div>
        )}

        {/* Create Item */}
        <section className="mb-8 p-6 bg-surface-alt rounded-2xl border border-border">
          <h2 className="font-display text-lg mb-4">Create Catalog Item</h2>
          <div className="space-y-4">
            <input
              type="text"
              value={itemDefId}
              onChange={(e) => setItemDefId(e.target.value)}
              placeholder="Item ID (e.g., deck_001)"
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:border-brand-orange"
            />
            <input
              type="text"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Item Name"
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:border-brand-orange"
            />
            <div className="grid grid-cols-3 gap-4">
              <select
                value={rarity}
                onChange={(e) => setRarity(e.target.value)}
                className="px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:border-brand-orange"
              >
                <option value="common">Common</option>
                <option value="uncommon">Uncommon</option>
                <option value="rare">Rare</option>
                <option value="limited">Limited</option>
                <option value="grail">Grail</option>
              </select>
              <select
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                className="px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:border-brand-orange"
              >
                <option value="deck">Deck</option>
                <option value="shoes">Shoes</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
                <option value="head">Head</option>
                <option value="accessory">Accessory</option>
              </select>
              <input
                type="number"
                value={priceBucks}
                onChange={(e) => setPriceBucks(e.target.value)}
                placeholder="Price (Bucks)"
                className="px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:border-brand-orange"
              />
            </div>
            <button
              onClick={handleCreateItem}
              disabled={loading || !itemDefId || !itemName}
              className="w-full px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "CREATE ITEM"}
            </button>
          </div>
        </section>

        {/* Create Drop */}
        <section className="mb-8 p-6 bg-surface-alt rounded-2xl border border-border">
          <h2 className="font-display text-lg mb-4">Create Drop</h2>
          <div className="space-y-4">
            <input
              type="text"
              value={dropId}
              onChange={(e) => setDropId(e.target.value)}
              placeholder="Drop ID (e.g., drop_2024_w42)"
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:border-brand-orange"
            />
            <input
              type="text"
              value={itemDefId}
              onChange={(e) => setItemDefId(e.target.value)}
              placeholder="Item ID to drop"
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:border-brand-orange"
            />
            <input
              type="number"
              value={dropStock}
              onChange={(e) => setDropStock(e.target.value)}
              placeholder="Stock (e.g., 250)"
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:border-brand-orange"
            />
            <button
              onClick={handleCreateDrop}
              disabled={loading || !dropId || !itemDefId}
              className="w-full px-6 py-3 bg-brand-orange text-surface-dark rounded-lg font-display hover:bg-brand-orange/90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "CREATE DROP"}
            </button>
          </div>
        </section>

        <p className="text-xs text-subtle text-center">
          Admin tools require elevated permissions. Contact a maintainer to grant admin access.
        </p>
      </div>
    </div>
  );
}
