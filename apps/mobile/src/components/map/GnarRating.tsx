import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Flame } from 'lucide-react-native';

interface GnarRatingProps {
  value: 1 | 2 | 3 | 4 | 5;
  size?: 'sm' | 'md';
  readonly?: boolean;
  onChange?: (value: 1 | 2 | 3 | 4 | 5) => void;
}

const SIZES = { sm: 14, md: 18 } as const;

export function GnarRating({ value, size = 'md', readonly = true, onChange }: GnarRatingProps) {
  const px = SIZES[size];

  return (
    <View style={styles.container} accessibilityRole="adjustable" accessibilityLabel={`Gnar rating: ${value} of 5`}>
      {([1, 2, 3, 4, 5] as const).map((i) => {
        const filled = i <= value;
        const color = filled ? '#F97316' : '#666';

        if (readonly) {
          return (
            <View key={i} style={styles.icon}>
              <Flame size={px} color={color} fill={filled ? '#F97316' : 'none'} strokeWidth={1.5} />
            </View>
          );
        }

        return (
          <TouchableOpacity key={i} onPress={() => onChange?.(i)} style={styles.icon}>
            <Flame size={px} color={color} fill={filled ? '#F97316' : 'none'} strokeWidth={1.5} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  icon: {
    padding: 2,
  },
});
