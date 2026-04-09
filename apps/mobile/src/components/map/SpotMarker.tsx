import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { Spot } from '@shared/types';

interface SpotMarkerProps {
  spot: Spot;
  isActiveGame?: boolean;
}

export function SpotMarker({ spot, isActiveGame = false }: SpotMarkerProps) {
  const backgroundColor = spot.isVerified ? '#22C55E' : '#F97316';

  return (
    <View style={styles.container}>
      {isActiveGame && <View style={styles.pulseRing} />}
      <View style={[styles.marker, { backgroundColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'white',
  },
  pulseRing: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F97316',
    opacity: 0.5,
  },
});
