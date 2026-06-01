import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { useTheme } from '../../theme/ThemeContext';

// Minimum ratings before we show a star score — below this a shop reads "New"
// (a single 5★ from a friend shouldn't look more trustworthy than an
// established shop with 200 reviews).
const MIN_RATINGS = 5;

interface Props {
  average: number | null;
  count: number;
  size?: number;
  showCount?: boolean;
}

export default function RatingBadge({ average, count, size = 13, showCount = true }: Props) {
  const { colors: Colors } = useTheme();

  if (count < MIN_RATINGS || average == null) {
    return (
      <View style={[styles.row, { backgroundColor: Colors.surfaceAlt }]}>
        <Text weight="bold" color={Colors.textSecondary} style={{ fontSize: size - 1 }}>
          New
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, { backgroundColor: Colors.successLight }]}>
      <Ionicons name="star" size={size - 1} color={Colors.success} />
      <Text weight="bold" color={Colors.success} style={{ fontSize: size }}>
        {average.toFixed(1)}
      </Text>
      {showCount && (
        <Text weight="medium" color={Colors.textTertiary} style={{ fontSize: size - 2 }}>
          ({count})
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
});
