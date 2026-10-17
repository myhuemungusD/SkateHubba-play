/**
 * Closet Shop screen — buy open-edition items with Hubba Bucks.
 * Plan §4.3: daily rotation, fixed price, known outcome.
 */
import { useEffect, useState } from "react";
import { Coins, ShoppingBag } from "lucide-react";
import {
  fetchShopItems,
  fetchWalletBalance,
  buyShopItem,
  type CatalogItem,
  type WalletBalance,
} from "../services/closet";
import { useAuth } from "../hooks/useAuth";
import { parseFirebaseError } from "../utils/helpers";
import { WalletDisplay } from "../components/WalletDisplay";
import { DesignerCredit } from "../components/DesignerCredit";
import { designerCreditFor } from "../lib/closet/mikeWhiteCollection";
import { trackEvent } from "../services/analytics";

export function ClosetShopScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [wallet, setWallet] = useState<WalletBalance>({ balance: 0, earnedBal: 0, boughtBal: 0 });
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      try {
        const [shopItems, walletData] = await Promise.all([fetchShopItems(), fetchWalletBalance(user.uid)]);
        setItems(shopItems);
        setWallet(walletData);
      } catch (err) {
        setError(parseFirebaseError(err));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [user]);

  const handleBuy = async (item: CatalogItem) => {
    if (!user || !item.priceBucks || purchasing) return;
    if (wallet.balance < item.priceBucks) {
      setError("Not enough Hubba Bucks");
      return;
    }

    setPurchasing(item.id);
    setError(null);

    try {
      await buyShopItem(item.id);
      const newWallet = await fetchWalletBalance(user.uid);
      setWallet(newWallet);
      trackEvent("closet_shop_purchase_success", { itemDefId: item.id, price: item.priceBucks });
    } catch (err) {
      const errorCode = parseFirebaseError(err);
      setError(errorCode === "already_owned" ? "You already own this item" : errorCode);
    } finally {
      setPurchasing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-orange border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <ShoppingBag size={32} className="text-brand-orange" />
            <h1 className="font-display text-3xl text-white">Shop</h1>
          </div>
          <WalletDisplay balance={wallet} size="lg" />
        </div>
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </header>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <ShoppingBag size={64} className="mx-auto mb-4 text-faint" />
          <p className="text-subtle">No items available right now</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item) => (
            <ShopItemCard
              key={item.id}
              item={item}
              onBuy={handleBuy}
              isPurchasing={purchasing === item.id}
              canAfford={wallet.balance >= (item.priceBucks ?? 0)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ShopItemCardProps {
  item: CatalogItem;
  onBuy: (item: CatalogItem) => void;
  isPurchasing: boolean;
  canAfford: boolean;
}

function ShopItemCard({ item, onBuy, isPurchasing, canAfford }: ShopItemCardProps) {
  const credit = designerCreditFor(item.id);
  const rarityColors: Record<string, string> = {
    common: "border-zinc-700/70",
    uncommon: "border-brand-green/50",
    rare: "border-blue-500/50",
    limited: "border-brand-orange/60",
    grail: "border-red-500/70",
  };

  const rarityTagColors: Record<string, string> = {
    common: "bg-zinc-500/15 text-zinc-300",
    uncommon: "bg-brand-green/15 text-brand-green",
    rare: "bg-blue-500/15 text-blue-400",
    limited: "bg-brand-orange/15 text-brand-orange",
    grail: "bg-red-500/15 text-red-400",
  };

  return (
    <div
      className={`rounded-2xl border bg-surface overflow-hidden ${rarityColors[item.rarity] ?? rarityColors.common}`}
    >
      <div className="aspect-square bg-surface-alt flex items-center justify-center">
        {item.artUrl ? (
          <img src={item.artUrl} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <ShoppingBag size={48} className="text-faint" />
        )}
      </div>
      <div className="p-4">
        <h3 className="font-display text-lg text-white truncate">{item.name}</h3>
        {credit ? (
          <DesignerCredit credit={credit} />
        ) : (
          item.licensed.brand && (
            <p className="text-xs text-subtle uppercase tracking-wider mt-1">{item.licensed.brand}</p>
          )
        )}
        <span
          className={`inline-block mt-2 px-2 py-1 rounded text-xs font-display tracking-wider ${rarityTagColors[item.rarity] ?? rarityTagColors.common}`}
        >
          {item.rarity.toUpperCase()}
        </span>
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1.5">
            <Coins size={16} className="text-yellow-500" />
            <span className="font-display text-sm text-white">{item.priceBucks?.toLocaleString()}</span>
          </div>
          <button
            onClick={() => onBuy(item)}
            disabled={isPurchasing || !canAfford}
            className={`px-4 py-2 rounded-lg font-display text-sm transition ${
              canAfford && !isPurchasing
                ? "bg-brand-orange text-white hover:bg-brand-orange-dark"
                : "bg-surface-alt text-subtle cursor-not-allowed"
            }`}
          >
            {isPurchasing ? "Buying..." : canAfford ? "Buy" : "Not enough Bucks"}
          </button>
        </div>
      </div>
    </div>
  );
}
