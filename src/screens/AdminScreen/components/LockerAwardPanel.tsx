import { useCallback, useEffect, useState } from "react";
import { awardLockerItem, removeLockerItem, type AdminLockerItemInput } from "../../../services/admin";
import { fetchLockerItems, type LockerItem } from "../../../services/locker";
import { useNotifications } from "../../../context/NotificationContext";
import { errorMessage } from "../utils";
import { AdminSelectField, AdminTextField } from "./AdminFormFields";
import { LockerItemList } from "./LockerItemList";

/** Catalogue categories the console can mint. Server-owned list, mirrored here. */
const TYPES = ["deck", "wheels", "trucks", "shoes", "apparel", "accessory", "limited"] as const;

/** Rarity tiers, lowest first — "common" is the safe default for a new item. */
const RARITIES = ["common", "uncommon", "rare", "limited"] as const;

const MAX_REASON = 200;

const EMPTY_FORM = {
  type: TYPES[0] as string,
  name: "",
  brand: "",
  rarity: RARITIES[0] as string,
  imageUrl: "",
  provenanceReason: "",
};

/**
 * Mint or remove a locker item for one player.
 *
 * Provenance is required, not optional: scarcity in this economy is "recorded
 * issuance date, reason, and ownership history" (ECONOMY.md), and an item with
 * no reason has no provenance to show. A blank image URL is sent as `null` —
 * an empty string makes the tile's `<img src>` re-request the current page
 * instead of falling back to the type icon.
 */
export function LockerAwardPanel({ uid, username }: { uid: string; username: string }) {
  const { notify } = useNotifications();
  const [form, setForm] = useState(EMPTY_FORM);
  const [data, setData] = useState<{ loadedUid: string; items: LockerItem[] }>({ loadedUid: "", items: [] });
  const [awarding, setAwarding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    fetchLockerItems(uid)
      .then((items) => {
        if (!stale) setData({ loadedUid: uid, items });
      })
      .catch((err: unknown) => {
        if (stale) return;
        setData({ loadedUid: uid, items: [] });
        notify({ type: "error", title: "Couldn't load locker", message: errorMessage(err) });
      });
    return () => {
      stale = true;
    };
  }, [uid, notify]);

  const refresh = useCallback(async () => {
    const items = await fetchLockerItems(uid);
    setData({ loadedUid: uid, items });
  }, [uid]);

  const setField = (key: keyof typeof EMPTY_FORM) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const award = async (): Promise<void> => {
    setAwarding(true);
    const item: AdminLockerItemInput = {
      type: form.type,
      brand: form.brand.trim(),
      name: form.name.trim(),
      imageUrl: form.imageUrl.trim() || null,
      rarity: form.rarity,
      provenanceReason: form.provenanceReason.trim(),
    };
    try {
      await awardLockerItem(uid, item);
      notify({ type: "success", title: "Item awarded", message: `${form.name.trim()} → @${username}` });
      setForm(EMPTY_FORM);
      await refresh();
    } catch (err: unknown) {
      notify({ type: "error", title: "Award failed", message: errorMessage(err) });
    } finally {
      setAwarding(false);
    }
  };

  const remove = async (itemId: string, itemName: string): Promise<void> => {
    setRemovingId(itemId);
    try {
      await removeLockerItem(uid, itemId);
      notify({ type: "success", title: "Item removed", message: `${itemName} → @${username}` });
      await refresh();
    } catch (err: unknown) {
      notify({ type: "error", title: "Remove failed", message: errorMessage(err) });
    } finally {
      setRemovingId(null);
    }
  };

  const incomplete = form.name.trim().length === 0 || form.provenanceReason.trim().length === 0;

  return (
    <section aria-label="Hubba Locker" className="mb-8">
      <h2 className="mb-3 font-display text-[10px] tracking-[0.2em] text-brand-orange">HUBBA LOCKER</h2>

      <AdminSelectField label="Type" value={form.type} onChange={setField("type")} options={TYPES} />
      <AdminTextField label="Name" value={form.name} onChange={setField("name")} placeholder="Ledge Killer Deck" />
      <AdminTextField label="Brand" value={form.brand} onChange={setField("brand")} placeholder="Optional" />
      <AdminSelectField label="Rarity" value={form.rarity} onChange={setField("rarity")} options={RARITIES} />
      <AdminTextField label="Image URL" value={form.imageUrl} onChange={setField("imageUrl")} placeholder="Optional" />
      <AdminTextField
        label="Provenance reason"
        value={form.provenanceReason}
        onChange={setField("provenanceReason")}
        placeholder="Why this item was issued"
        maxLength={MAX_REASON}
        note={`${form.provenanceReason.length}/${MAX_REASON}`}
      />

      <button
        type="button"
        onClick={() => void award()}
        disabled={incomplete || awarding}
        className="mb-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-brand-orange/40 bg-brand-orange/[0.12] px-4 font-display text-[11px] tracking-[0.15em] text-brand-orange transition-colors active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
      >
        {awarding ? "..." : "AWARD ITEM"}
      </button>

      <LockerItemList
        items={data.items}
        loading={data.loadedUid !== uid}
        username={username}
        removingId={removingId}
        onRemove={remove}
      />
    </section>
  );
}
