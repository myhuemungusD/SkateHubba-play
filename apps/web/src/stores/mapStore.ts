import { create } from 'zustand';
import type { Spot } from '@shared/types';

interface MapState {
  spots: Spot[];
  selectedSpot: Spot | null;
  isAddingSpot: boolean;
  userLocation: { lat: number; lng: number } | null;
  isTrackingUser: boolean;

  setSpots: (spots: Spot[]) => void;
  setSelectedSpot: (spot: Spot | null) => void;
  setIsAddingSpot: (v: boolean) => void;
  setUserLocation: (loc: { lat: number; lng: number }) => void;
  setIsTrackingUser: (v: boolean) => void;
}

export const useMapStore = create<MapState>((set) => ({
  spots: [],
  selectedSpot: null,
  isAddingSpot: false,
  userLocation: null,
  isTrackingUser: true,

  setSpots: (spots) => set({ spots }),
  setSelectedSpot: (spot) => set({ selectedSpot: spot }),
  setIsAddingSpot: (v) => set({ isAddingSpot: v }),
  setUserLocation: (loc) => set({ userLocation: loc }),
  setIsTrackingUser: (v) => set({ isTrackingUser: v }),
}));
