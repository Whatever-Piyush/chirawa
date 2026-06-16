import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Shimmer } from '../ui';
import { PRODUCT_CARD_WIDTH } from './ProductCard';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';

// Shimmer skeleton for the 2-col product grid — matches ProductCard ("regular"),
// so a category/list load shows the real layout filling in (premium perceived
// performance) instead of a bare spinner. Pure Shimmer; no new deps.
const W = PRODUCT_CARD_WIDTH;

function SkeletonCard({ Colors }: { Colors: ColorPalette }) {
  const s = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={s.card}>
      <Shimmer width="100%" height={120} borderRadius={12} />
      <View style={{ height: 10 }} />
      <Shimmer width="45%" height={12} />
      <View style={{ height: 8 }} />
      <Shimmer width="35%" height={16} borderRadius={5} />
      <View style={{ height: 6 }} />
      <Shimmer width="90%" height={12} />
    </View>
  );
}

export default function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  const { colors: Colors } = useTheme();
  const s = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={s.wrap}>
      <View style={s.grid}>
        {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} Colors={Colors} />)}
      </View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    wrap: { flex: 1, backgroundColor: Colors.background },
    grid: {
      padding: 16, flexDirection: 'row', flexWrap: 'wrap',
      justifyContent: 'space-between', rowGap: 12,
    },
    card: {
      width: W, backgroundColor: Colors.surface, borderRadius: 14,
      borderWidth: 1, borderColor: Colors.border, padding: 10,
    },
  });
