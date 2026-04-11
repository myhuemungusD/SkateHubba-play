/**
 * Shared types for the skate spots feature.
 *
 * Previously lived in packages/shared — consolidated into src/ as part of
 * the charter-compliance pass that removed the custom apps/api backend.
 * These types describe the client-side Spot model as it exists in the UI
 * and on Firestore (with timestamps normalized to ISO strings at the
 * service boundary).
 */

export type ObstacleType =
  | "ledge"
  | "rail"
  | "stairs"
  | "gap"
  | "bank"
  | "bowl"
  | "manual_pad"
  | "quarter_pipe"
  | "euro_gap"
  | "slappy_curb"
  | "hip"
  | "hubba"
  | "flatground"
  | "other";

export interface Spot {
  id: string;
  createdBy: string;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  gnarRating: 1 | 2 | 3 | 4 | 5;
  bustRisk: 1 | 2 | 3 | 4 | 5;
  obstacles: ObstacleType[];
  photoUrls: string[]; // max 5
  isVerified: boolean;
  isActive: boolean;
  createdAt: string; // ISO string
  updatedAt: string;
}

export interface SpotComment {
  id: string;
  spotId: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface CreateSpotRequest {
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  gnarRating: 1 | 2 | 3 | 4 | 5;
  bustRisk: 1 | 2 | 3 | 4 | 5;
  obstacles: ObstacleType[];
  photoUrls: string[];
}
