import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { Plus, Crosshair } from 'lucide-react-native';
import type { Spot, SpotGeoJSON } from '@shared/types';

// Assumption: MAPBOX_TOKEN set via MapboxGL.setAccessToken in app entry
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? '';

interface MapScreenProps {
  activeGameSpotId?: string;
  onSpotPress?: (spot: Spot) => void;
  onAddSpotPress?: () => void;
}

export function MapScreen({ activeGameSpotId, onSpotPress, onAddSpotPress }: MapScreenProps) {
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTracking, setIsTracking] = useState(true);
  const hasLockedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSpots = useCallback(async (bounds: { ne: number[]; sw: number[] }) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams({
      north: bounds.ne[1].toString(),
      south: bounds.sw[1].toString(),
      east: bounds.ne[0].toString(),
      west: bounds.sw[0].toString(),
    });

    try {
      const res = await fetch(`${API_BASE}/api/spots/bounds?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = await res.json() as { features: SpotGeoJSON[] };
      if (Array.isArray(data.features)) {
        setSpots(data.features.map((f: SpotGeoJSON) => f.properties));
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.warn('Failed to fetch spots:', err.message);
      }
    }
  }, []);

  const handleRegionChange = useCallback(
    (feature: GeoJSON.Feature<GeoJSON.Point>) => {
      // Assumption: onRegionDidChange provides visible bounds via properties
      const bounds = (feature.properties as Record<string, unknown>)?.visibleBounds as number[][] | undefined;
      if (bounds && bounds.length === 2) {
        fetchSpots({ ne: bounds[0], sw: bounds[1] });
      }
    },
    [fetchSpots],
  );

  const handleUserLocationUpdate = useCallback(
    (location: MapboxGL.Location) => {
      const loc = { lat: location.coords.latitude, lng: location.coords.longitude };
      setUserLocation(loc);

      if (!hasLockedRef.current && cameraRef.current) {
        cameraRef.current.setCamera({
          centerCoordinate: [loc.lng, loc.lat],
          zoomLevel: 15,
          animationDuration: 1000,
        });
        hasLockedRef.current = true;
      }
    },
    [],
  );

  const handleRecenter = useCallback(() => {
    if (!userLocation) {
      Alert.alert('Location', 'Waiting for location\u2026');
      return;
    }
    setIsTracking(true);
    cameraRef.current?.setCamera({
      centerCoordinate: [userLocation.lng, userLocation.lat],
      zoomLevel: 15,
      animationDuration: 500,
    });
  }, [userLocation]);

  // Build GeoJSON for spot markers
  const spotsGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: spots.map((s) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [s.longitude, s.latitude],
      },
      properties: {
        id: s.id,
        isVerified: s.isVerified,
        isActiveGame: s.id === activeGameSpotId,
        name: s.name,
      },
    })),
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return (
    <View style={styles.container}>
      <MapboxGL.MapView
        style={styles.map}
        styleURL={MAP_STYLE}
        onTouchStart={() => setIsTracking(false)}
        onRegionDidChange={handleRegionChange}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [-118.2437, 34.0522],
            zoomLevel: 13,
          }}
          followUserLocation={isTracking}
          minZoomLevel={5}
          maxZoomLevel={19}
        />

        <MapboxGL.UserLocation
          visible
          onUpdate={handleUserLocationUpdate}
          renderMode="normal"
          androidRenderMode="compass"
        />

        {/* Spot markers via ShapeSource + clustering */}
        <MapboxGL.ShapeSource
          id="spots-source"
          shape={spotsGeoJSON}
          cluster
          clusterRadius={50}
          onPress={(e) => {
            const feature = e.features[0];
            if (!feature || !feature.properties) return;

            // If it's a cluster, zoom in
            if (feature.properties.cluster) {
              const coords = (feature.geometry as GeoJSON.Point).coordinates;
              cameraRef.current?.setCamera({
                centerCoordinate: coords,
                zoomLevel: (feature.properties.cluster_expansion_zoom as number) ?? 14,
                animationDuration: 500,
              });
              return;
            }

            // Find the spot and call callback
            const spotId = feature.properties.id as string;
            const spot = spots.find((s) => s.id === spotId);
            if (spot) onSpotPress?.(spot);
          }}
        >
          {/* Cluster circles */}
          <MapboxGL.CircleLayer
            id="spots-cluster"
            filter={['has', 'point_count']}
            style={{
              circleColor: '#888780',
              circleRadius: 18,
              circleBorderWidth: 1,
              circleBorderColor: '#fff',
            }}
          />
          <MapboxGL.SymbolLayer
            id="spots-cluster-count"
            filter={['has', 'point_count']}
            style={{
              textField: ['get', 'point_count_abbreviated'],
              textSize: 12,
              textColor: '#ffffff',
              textFont: ['DIN Pro Medium'],
            }}
          />

          {/* Individual spot markers */}
          <MapboxGL.CircleLayer
            id="spots-individual"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleColor: [
                'case',
                ['get', 'isVerified'], '#22C55E',
                '#F97316',
              ],
              circleRadius: 10,
              circleBorderWidth: 1,
              circleBorderColor: '#fff',
            }}
          />
        </MapboxGL.ShapeSource>
      </MapboxGL.MapView>

      {/* Empty state */}
      {spots.length === 0 && (
        <View style={styles.emptyBanner}>
          <Text style={styles.emptyText}>No spots nearby. Add one!</Text>
        </View>
      )}

      {/* Recenter button */}
      <TouchableOpacity
        style={styles.recenterButton}
        onPress={handleRecenter}
        accessibilityLabel="Recenter to my location"
      >
        <Crosshair size={16} color="#fff" />
      </TouchableOpacity>

      {/* Add spot FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={onAddSpotPress}
        accessibilityLabel="Add a spot"
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  emptyBanner: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(26,26,26,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  emptyText: {
    color: '#888',
    fontSize: 13,
  },
  recenterButton: {
    position: 'absolute',
    bottom: 140,
    right: 12,
    width: 36,
    height: 36,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 12,
    width: 48,
    height: 48,
    backgroundColor: '#F97316',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
