-- Migration: Add spots and spot_comments tables for SkateHubba map feature

CREATE TYPE "obstacle_type" AS ENUM (
  'ledge', 'rail', 'stairs', 'gap', 'bank', 'bowl',
  'manual_pad', 'quarter_pipe', 'euro_gap', 'slappy_curb',
  'hip', 'hubba', 'flatground', 'other'
);

CREATE TABLE "spots" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_by"   text NOT NULL,
  "name"         text NOT NULL,
  "description"  text,
  "latitude"     double precision NOT NULL,
  "longitude"    double precision NOT NULL,
  "gnar_rating"  smallint NOT NULL DEFAULT 1,
  "bust_risk"    smallint NOT NULL DEFAULT 1,
  "obstacles"    obstacle_type[] NOT NULL DEFAULT '{}',
  "photo_urls"   text[] NOT NULL DEFAULT '{}',
  "is_verified"  boolean NOT NULL DEFAULT false,
  "is_active"    boolean NOT NULL DEFAULT true,
  "created_at"   timestamp DEFAULT now() NOT NULL,
  "updated_at"   timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "spot_comments" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "spot_id"    uuid NOT NULL REFERENCES "spots"("id") ON DELETE CASCADE,
  "user_id"    text NOT NULL,
  "content"    text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Spatial index for bounding-box queries
CREATE INDEX "spots_lat_lng_idx" ON "spots" ("latitude", "longitude");

-- Index for fetching comments by spot
CREATE INDEX "spot_comments_spot_id_idx" ON "spot_comments" ("spot_id");
