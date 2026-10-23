#!/usr/bin/env node
/**
 * Seed the map from OpenStreetMap (Overpass API) plus the curated legendary
 * list. docs/MAP_ROADMAP.md, Phase 1 "Seeding the map".
 *
 *   node scripts/map/seed_osm.mjs --region US --dry-run      # fetch + dedupe, write nothing
 *   node scripts/map/seed_osm.mjs --region US                # write
 *   node scripts/map/seed_osm.mjs --legendary-only [--dry-run]
 *
 * Auth: Application Default Credentials (gcloud auth application-default login).
 * Data: © OpenStreetMap contributors, ODbL. Every seeded doc keeps
 * source "osm" + osmId so it can be credited and refreshed. Seeded spots
 * start unverified and stay hidden in the app until VITE_FEATURE_MAP_CHECKINS
 * is on. One region per run keeps us inside Overpass fair use.
 *
 * Idempotent: doc ids come from the OSM id, so a re-run updates instead of
 * duplicating. A seed within 50 m of an existing spot with a similar name
 * (or any nearby spot, for an unnamed park) is skipped: user spots win.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY = flag("dry-run");
const LEGENDARY_ONLY = flag("legendary-only");
const REGION = opt("region", "US");
const PROJECT = opt("project", "sk8hub-d7806");
const DATABASE = opt("database", "skatehubba");
const OVERPASS = opt("overpass", "https://overpass-api.de/api/interpreter");
const DEDUPE_M = 50;

export function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** UUID-shaped id from a stable key, so the app's spot id check accepts it and re-runs are stable. */
export function idFor(key) {
  const h = createHash("sha1").update(`skatehubba:${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const STOP = new Set(["the", "skatepark", "skate", "park", "plaza", "spot", "of", "and", "at"]);
const tokens = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t && !STOP.has(t)),
  );

export function similarName(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return true; // generic names ("Skatepark") match anything nearby
  let both = 0;
  for (const t of ta) if (tb.has(t)) both += 1;
  return both / Math.min(ta.size, tb.size) >= 0.5;
}

export function overpassQuery(region) {
  return `[out:json][timeout:900];
area["ISO3166-1"="${region}"][admin_level=2]->.a;
(
  nwr["leisure"="skatepark"](area.a);
  nwr["leisure"="pitch"]["sport"~"(^|;)skateboard(;|$)"](area.a);
  nwr["shop"="skate"](area.a);
  nwr["shop"="sports"]["sport"~"(^|;)skateboard(;|$)"](area.a);
);
out center tags;`;
}

/** Overpass element → seed, or null when it should not be seeded. */
export function toSeed(el) {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (["private", "no"].includes(tags.access)) return null;
  if (tags.disused === "yes" || tags.abandoned === "yes") return null;
  const kind = tags.shop ? "shop" : "park";
  const rawName = (tags.name ?? "").trim();
  if (kind === "shop" && !rawName) return null;
  const city = tags["addr:city"];
  const name = (rawName || (city ? `Skatepark (${city})` : "Skatepark")).slice(0, 80);
  const osmId = `${el.type}/${el.id}`;
  return { id: idFor(`osm:${osmId}`), osmId, name, named: rawName.length > 0, kind, lat, lng };
}

/** Drop seeds that duplicate each other or an existing spot. */
export function dedupe(seeds, existing) {
  const byOsm = new Set(existing.filter((s) => s.osmId).map((s) => s.osmId));
  const kept = [];
  const skipped = { existingOsm: 0, nearExisting: 0, nearSeed: 0 };
  // Coarse grid (~500 m cells) so the 50 m check isn't O(n²) across a country.
  const key = (y, x) => `${y}:${x}`;
  const grid = new Map();
  const add = (s) => {
    const k = key(Math.floor(s.lat * 200), Math.floor(s.lng * 200));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  };
  const near = (s) => {
    const out = [];
    const cy = Math.floor(s.lat * 200);
    const cx = Math.floor(s.lng * 200);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) out.push(...(grid.get(key(cy + dy, cx + dx)) ?? []));
    }
    return out.filter((o) => distanceM(s.lat, s.lng, o.lat, o.lng) <= DEDUPE_M);
  };
  for (const e of existing) add({ ...e, existing: true });
  // Named seeds first so a named park wins over an unnamed duplicate pitch.
  const ordered = [...seeds].sort((a, b) => Number(b.named) - Number(a.named));
  for (const s of ordered) {
    if (byOsm.has(s.osmId)) {
      skipped.existingOsm += 1;
      continue;
    }
    const clash = near(s).find((o) => {
      const comparable = o.existing || o.kind === s.kind; // a shop next to a park is not a duplicate
      return comparable && (!s.named || similarName(s.name, o.name));
    });
    if (clash) {
      if (clash.existing) skipped.nearExisting += 1;
      else skipped.nearSeed += 1;
      continue;
    }
    kept.push(s);
    add(s);
  }
  return { kept, skipped };
}

// Overpass etiquette asks for a contact in the User-Agent. Set
// OVERPASS_CONTACT (an email or URL) when running the seed; the public repo
// only ships the published support address.
function overpassUserAgent() {
  const contact = process.env.OVERPASS_CONTACT?.trim() || "support@skatehubba.com";
  return `SkateHubba-seed/1.0 (${contact})`;
}

async function fetchOverpass(region) {
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": overpassUserAgent(),
    },
    body: `data=${encodeURIComponent(overpassQuery(region))}`,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return json.elements ?? [];
}

function loadAdmin() {
  const require = createRequire(resolve(here, "../../functions/package.json"));
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
  return { db: getFirestore(app, DATABASE), FieldValue };
}

async function main() {
  const legendary = JSON.parse(readFileSync(resolve(here, "legendary_spots.json"), "utf8")).spots;
  let seeds = [];
  let rawCount = 0;
  if (!LEGENDARY_ONLY) {
    const cached = opt("from-file", null);
    console.log(cached ? `Reading ${cached}…` : `Fetching OSM skateparks and skate shops for ${REGION}…`);
    const elements = cached ? JSON.parse(readFileSync(cached, "utf8")).elements : await fetchOverpass(REGION);
    rawCount = elements.length;
    seeds = elements.map(toSeed).filter(Boolean);
    console.log(`Overpass returned ${rawCount} elements; ${seeds.length} usable.`);
  }

  // Existing spots, for dedupe. A dry run without credentials dedupes the OSM set only.
  let existing = [];
  let admin = null;
  try {
    admin = loadAdmin();
    const snap = await admin.db.collection("spots").select("latitude", "longitude", "name", "osmId", "kind").get();
    existing = snap.docs
      .map((d) => ({
        id: d.id,
        lat: d.get("latitude"),
        lng: d.get("longitude"),
        name: d.get("name") ?? "",
        osmId: d.get("osmId") ?? null,
        kind: d.get("kind") ?? "spot",
      }))
      .filter((s) => typeof s.lat === "number" && typeof s.lng === "number");
    console.log(`Existing spots in ${DATABASE}: ${existing.length}`);
  } catch (err) {
    if (!DRY) throw err;
    console.log(`(dry run) No Firestore access (${String(err.message).split("\n")[0]}); deduping OSM data only.`);
  }

  const { kept, skipped } = dedupe(seeds, existing);
  const parks = kept.filter((s) => s.kind === "park").length;
  const shops = kept.length - parks;

  const legendaryPlan = legendary.map((l) => {
    const match = existing.find((e) => distanceM(l.lat, l.lng, e.lat, e.lng) <= 75 && similarName(l.name, e.name));
    return { ...l, target: match ? match.id : idFor(`legend:${l.slug}`), mergeIntoExisting: Boolean(match) };
  });

  const report = {
    region: LEGENDARY_ONLY ? null : REGION,
    dryRun: DRY,
    existingSpots: existing.length,
    overpassElements: rawCount,
    toWrite: { parks, shops, total: kept.length },
    skipped,
    legendary: legendaryPlan.map(({ slug, target, mergeIntoExisting, checkinsAllowed }) => ({
      slug,
      target,
      mergeIntoExisting,
      checkinsAllowed,
    })),
    sample: kept.slice(0, 10).map(({ name, kind, lat, lng, osmId }) => ({ name, kind, lat, lng, osmId })),
  };
  const out = resolve(process.cwd(), `osm-seed-${LEGENDARY_ONLY ? "legendary" : REGION}${DRY ? "-dry" : ""}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, sample: undefined }, null, 2));
  console.log(`Report: ${out}`);
  if (DRY) return;

  const { db, FieldValue } = admin;
  let batch = db.batch();
  let n = 0;
  let written = 0;
  const flush = async () => {
    if (n === 0) return;
    await batch.commit();
    written += n;
    batch = db.batch();
    n = 0;
    process.stdout.write(`\rwritten ${written}`);
  };
  for (const s of kept) {
    batch.set(db.collection("spots").doc(s.id), {
      createdBy: "osm-seed",
      name: s.name,
      description: null,
      latitude: s.lat,
      longitude: s.lng,
      gnarRating: 1,
      bustRisk: 1,
      obstacles: [],
      photoUrls: [],
      isVerified: false,
      isActive: true,
      source: "osm",
      osmId: s.osmId,
      kind: s.kind,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    n += 1;
    if (n === 400) await flush();
  }
  for (const l of legendaryPlan) {
    const legendFields = {
      isLegendary: true,
      legendaryBadgeId: `legend_${l.slug}`,
      checkinsAllowed: l.checkinsAllowed !== false,
    };
    if (l.mergeIntoExisting) {
      batch.set(db.collection("spots").doc(l.target), legendFields, { merge: true });
    } else {
      batch.set(db.collection("spots").doc(l.target), {
        createdBy: "curated",
        name: l.name,
        description: null,
        latitude: l.lat,
        longitude: l.lng,
        gnarRating: 4,
        bustRisk: 3,
        obstacles: [],
        photoUrls: [],
        isVerified: true,
        isActive: true,
        source: "curated",
        kind: "spot",
        ...legendFields,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    n += 1;
    if (n === 400) await flush();
  }
  await flush();
  console.log(`\nDone: ${kept.length} OSM spots, ${legendaryPlan.length} legendary.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
