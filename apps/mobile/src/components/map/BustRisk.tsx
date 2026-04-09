import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';

interface BustRiskProps {
  value: 1 | 2 | 3 | 4 | 5;
  size?: 'sm' | 'md';
  readonly?: boolean;
  onChange?: (value: 1 | 2 | 3 | 4 | 5) => void;
}

const SIZES = { sm: 14, md: 18 } as const;

export function BustRisk({ value, size = 'md', readonly = true, onChange }: BustRiskProps) {
  const px = SIZES[size];

  return (
    <View style={styles.container} accessibilityRole="adjustable" accessibilityLabel={`Bust risk: ${value} of 5`}>
      {([1, 2, 3, 4, 5] as const).map((i) => {
        const filled = i <= value;
        const color = filled ? '#EF4444' : '#666';

        if (readonly) {
          return (
            <View key={i} style={styles.icon}>
              <ShieldAlert size={px} color={color} fill={filled ? '#EF4444' : 'none'} strokeWidth={1.5} />
            </View>
          );
        }

        return (
          <TouchableOpacity key={i} onPress={() => onChange?.(i)} style={styles.icon}>
            <ShieldAlert size={px} color={color} fill={filled ? '#EF4444' : 'none'} strokeWidth={1.5} />
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
