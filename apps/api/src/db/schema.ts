import { pgTable, pgEnum, uuid, text, doublePrecision, smallint, boolean, timestamp } from "drizzle-orm/pg-core";

export const obstacleTypeEnum = pgEnum("obstacle_type", [
  "ledge",
  "rail",
  "stairs",
  "gap",
  "bank",
  "bowl",
  "manual_pad",
  "quarter_pipe",
  "euro_gap",
  "slappy_curb",
  "hip",
  "hubba",
  "flatground",
  "other",
]);

// NOTE: the underlying table also has a `geom geography(Point,4326)` column
// that is GENERATED ALWAYS from (longitude, latitude) — see migration
// 0002_add_postgis_gist_index.sql. It is read-only and queried exclusively
// via raw SQL in the /bounds route handler, so it is deliberately omitted
// from this Drizzle schema to keep `$inferSelect` stable for `rowToSpot`.
export const spots = pgTable("spots", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdBy: text("created_by").notNull(), // Firebase Auth UID
  name: text("name").notNull(),
  description: text("description"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  gnarRating: smallint("gnar_rating").notNull().default(1), // 1–5
  bustRisk: smallint("bust_risk").notNull().default(1), // 1–5, 1=safe
  obstacles: obstacleTypeEnum("obstacles").array().notNull().default([]),
  photoUrls: text("photo_urls").array().notNull().default([]), // max 5
  isVerified: boolean("is_verified").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const spotComments = pgTable("spot_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  spotId: uuid("spot_id")
    .notNull()
    .references(() => spots.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
