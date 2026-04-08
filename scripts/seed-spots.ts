#!/usr/bin/env npx tsx
/**
 * Seed skate spots from OpenStreetMap via the Overpass API.
 *
 * Usage:
 *   npx tsx scripts/seed-spots.ts
 *   npx tsx scripts/seed-spots.ts --dry-run
 *
 * Requires:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key
 *     (or running on a machine with default application credentials)
 *   - The firebase-admin package: npm install -D firebase-admin
 *
 * What it does:
 *   1. Queries OSM Overpass API for sport=skateboard features in major skate cities
 *   2. Writes each spot to the Firestore `spots` collection
 *
 * Admin SDK bypasses Firestore security rules, so no rule changes are needed.
 * Spots are created with createdByUid "SYSTEM_SEED" and username "skatehubba".
 *
 * Data source: OpenStreetMap (ODbL license — attribution required in app).
 * https://www.openstreetmap.org/copyright
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const FIRESTORE_DB_ID = "skatehubba";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SYSTEM_UID = "SYSTEM_SEED";
const SYSTEM_USERNAME = "skatehubba";

/** Major skate cities — bounding boxes as "south,west,north,east". */
const REGIONS: Record<string, string> = {
  "Los Angeles":   "33.5,-118.8,34.4,-117.7",
  "San Francisco": "37.6,-122.6,37.9,-122.2",
  "New York":      "40.4,-74.3,40.9,-73.7",
  "Portland":      "45.3,-123.0,45.7,-122.4",
  "Barcelona":     "41.3,2.0,41.5,2.3",
  "Phoenix":       "33.2,-112.3,33.7,-111.8",
  "Chicago":       "41.6,-87.9,42.1,-87.5",
  "Denver":        "39.5,-105.1,39.9,-104.8",
  "Austin":        "30.1,-97.9,30.5,-97.5",
  "Seattle":       "47.4,-122.5,47.8,-122.2",
};

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function fetchSkateSpots(bbox: string): Promise<OverpassElement[]> {
  const query = `
    [out:json][timeout:120];
    (
      node["sport"="skateboard"](${bbox});
      way["sport"="skateboard"](${bbox});
      relation["sport"="skateboard"](${bbox});
    );
    out center;
  `;

  const resp = await fetch(OVERPASS_URL, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!resp.ok) {
    throw new Error(`Overpass API error: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as { elements: OverpassElement[] };
  return data.elements;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log("DRY RUN — no data will be written to Firestore.\n");
  }

  // Initialize Admin SDK
  let db: FirebaseFirestore.Firestore | null = null;

  if (!dryRun) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath) {
      const serviceAccount = JSON.parse(readFileSync(credPath, "utf-8")) as ServiceAccount;
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      initializeApp();
    }
    db = getFirestore(FIRESTORE_DB_ID);
  }

  let totalAdded = 0;
  let totalSkipped = 0;

  for (const [city, bbox] of Object.entries(REGIONS)) {
    console.log(`\nFetching spots for ${city}...`);

    let elements: OverpassElement[];
    try {
      elements = await fetchSkateSpots(bbox);
    } catch (err) {
      console.error(`  Failed to fetch ${city}:`, err);
      continue;
    }

    console.log(`  Found ${elements.length} features`);

    for (const el of elements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const name = el.tags?.name || `Skatepark (${city})`;

      if (!lat || !lon) {
        totalSkipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  [dry-run] ${name} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
      } else {
        await db!.collection("spots").add({
          name,
          latitude: lat,
          longitude: lon,
          createdByUid: SYSTEM_UID,
          createdByUsername: SYSTEM_USERNAME,
          createdAt: FieldValue.serverTimestamp(),
          gameCount: 0,
        });
        console.log(`  Added: ${name} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
      }

      totalAdded++;
    }

    // Respect Overpass API rate limits (max 2 requests per 10 seconds)
    await sleep(5000);
  }

  console.log(`\nDone! ${totalAdded} spots added, ${totalSkipped} skipped (no coordinates).`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
