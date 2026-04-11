-- Migration: Upgrade the spots table to a PostGIS GiST spatial index.
--
-- The previous composite B-tree on (latitude, longitude) degrades to
-- sequential scans on bounding-box queries past ~10k rows, which is well
-- below the spot counts competitor apps ship with (26k–34k). Replacing it
-- with a proper GiST index over a generated geography(Point, 4326) column
-- keeps viewport queries on the GiST index and makes the operator
-- selection explicit (bbox overlap via &&).

-- Enable PostGIS (no-op if already enabled). Neon 16 supports PostGIS.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Generated geography(Point, 4326) column derived from (longitude, latitude).
-- Using geography (not geometry) because queries are lon/lat on the globe.
-- ST_MakePoint order is (x, y) = (longitude, latitude).
-- IF NOT EXISTS makes this migration safe to re-run if a previous attempt
-- succeeded on the column but failed on the index (drizzle-kit tracks
-- applied migrations by hash, so this is belt-and-suspenders).
ALTER TABLE "spots"
  ADD COLUMN IF NOT EXISTS "geom" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
  ) STORED;

-- GiST spatial index on the generated column
CREATE INDEX IF NOT EXISTS "spots_geom_gist_idx" ON "spots" USING GIST ("geom");

-- Drop the old B-tree composite — dominated by the GiST index for bbox
-- queries and costs write amplification for no read benefit now.
DROP INDEX IF EXISTS "spots_lat_lng_idx";
