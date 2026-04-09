export type ObstacleType =
  | 'ledge' | 'rail' | 'stairs' | 'gap' | 'bank' | 'bowl'
  | 'manual_pad' | 'quarter_pipe' | 'euro_gap' | 'slappy_curb'
  | 'hip' | 'hubba' | 'flatground' | 'other';

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
  photoUrls: string[];           // max 5
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;             // ISO string
  updatedAt: string;
}

export interface SpotComment {
  id: string;
  spotId: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface SpotGeoJSON {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: Spot;
}

export interface SpotsInBoundsRequest {
  north: number;
  south: number;
  east: number;
  west: number;
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
