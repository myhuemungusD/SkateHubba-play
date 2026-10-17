/**
 * Closet catalog service — fetch item definitions (what can be earned or bought).
 * All catalog docs are server-written and public-read.
 */
import { collection, doc, getDocs, getDoc, query, where, type DocumentSnapshot } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";
import { toDateOrNull } from "./closet.time";

export type Rarity = "common" | "uncommon" | "rare" | "limited" | "grail";
export type Slot = "head" | "top" | "bottom" | "shoes" | "deck" | "accessory";
export type EditionKind = "open" | "limited" | "one_of_one";
export type Source = "earn" | "drop" | "pro_signature" | "event" | "shop";

export interface Edition {
  kind: EditionKind;
  supply: number | null;
  minted: number;
  soldOut: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  type: string;
  slot: Slot;
  rarity: Rarity;
  artUrl: string;
  layerUrls: { front: string; back: string | null };
  model3dUrl: string | null;
  edition: Edition;
  source: Source;
  priceBucks: number | null;
  dropId: string | null;
  licensed: { brand: string | null; licenseRef: string | null };
  releasedAt: Date | null;
  retiredAt: Date | null;
}

function parseCatalogDoc(snap: DocumentSnapshot): CatalogItem | null {
  const raw = snap.data();
  if (!raw) return null;

  const edition = raw.edition as Record<string, unknown> | undefined;
  const layers = raw.layerUrls as Record<string, unknown> | undefined;
  const licensed = raw.licensed as Record<string, unknown> | undefined;

  return {
    id: snap.id,
    name: typeof raw.name === "string" ? raw.name : "",
    type: typeof raw.type === "string" ? raw.type : "",
    slot: (raw.slot as Slot) ?? "accessory",
    rarity: (raw.rarity as Rarity) ?? "common",
    artUrl: typeof raw.artUrl === "string" ? raw.artUrl : "",
    layerUrls: {
      front: typeof layers?.front === "string" ? layers.front : "",
      back: typeof layers?.back === "string" ? layers.back : null,
    },
    model3dUrl: typeof raw.model3dUrl === "string" ? raw.model3dUrl : null,
    edition: {
      kind: (edition?.kind as EditionKind) ?? "open",
      supply: typeof edition?.supply === "number" ? edition.supply : null,
      minted: typeof edition?.minted === "number" ? edition.minted : 0,
      soldOut: edition?.soldOut === true,
    },
    source: (raw.source as Source) ?? "earn",
    priceBucks: typeof raw.priceBucks === "number" ? raw.priceBucks : null,
    dropId: typeof raw.dropId === "string" ? raw.dropId : null,
    licensed: {
      brand: typeof licensed?.brand === "string" ? licensed.brand : null,
      licenseRef: typeof licensed?.licenseRef === "string" ? licensed.licenseRef : null,
    },
    releasedAt: toDateOrNull(raw.releasedAt),
    retiredAt: toDateOrNull(raw.retiredAt),
  };
}

/**
 * Fetch one catalog item by id. Returns null if not found or malformed.
 */
export async function fetchCatalogItem(itemDefId: string): Promise<CatalogItem | null> {
  try {
    const snap = await withRetry(() => getDoc(doc(requireDb(), "catalog", itemDefId)));
    if (!snap.exists()) return null;
    return parseCatalogDoc(snap);
  } catch (err) {
    logger.warn("fetch_catalog_item_failed", { itemDefId, error: parseFirebaseError(err) });
    return null;
  }
}

/**
 * Fetch all released items from the catalog. Filters by source if provided.
 * Returns items sorted by release date (newest first).
 */
export async function fetchCatalog(sourceFilter?: Source): Promise<CatalogItem[]> {
  try {
    const catalogRef = collection(requireDb(), "catalog");
    const q = sourceFilter ? query(catalogRef, where("source", "==", sourceFilter)) : catalogRef;

    const snap = await withRetry(() => getDocs(q));
    const live: { item: CatalogItem; releasedMs: number }[] = [];
    const now = Date.now();

    for (const docSnap of snap.docs) {
      const parsed = parseCatalogDoc(docSnap);
      if (!parsed?.releasedAt) continue;

      const releasedMs = parsed.releasedAt.getTime();
      const retired = parsed.retiredAt && parsed.retiredAt.getTime() <= now;
      if (releasedMs <= now && !retired) live.push({ item: parsed, releasedMs });
    }

    return live.sort((a, b) => b.releasedMs - a.releasedMs).map((entry) => entry.item);
  } catch (err) {
    logger.warn("fetch_catalog_failed", { error: parseFirebaseError(err) });
    return [];
  }
}

/**
 * Fetch shop items (source === "shop") that are currently released.
 * Excludes sold-out limited editions.
 */
export async function fetchShopItems(): Promise<CatalogItem[]> {
  const items = await fetchCatalog("shop");
  return items.filter((item) => !item.edition.soldOut);
}
