import React, { useMemo } from 'react';
import { View, Text as RNText, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Text } from '../../components/ui';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import type { ApiCategory } from '../../services/catalog';
import { SECTION_GROUPS } from './categoryMeta';

interface Props {
  categories: ApiCategory[];
  onSelect:   (name: string) => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HPAD = 16;
const GAP  = 10;
const COLS = 4;
const TILE_W = Math.floor((SCREEN_WIDTH - HPAD * 2 - GAP * (COLS - 1)) / COLS);

// Themed category sections — each a title followed by a grid of equal-size
// tiles (4 per row). Each tile is a copyright-safe emoji icon + label that
// opens a real product category. Tiles whose backing category isn't live are
// hidden.
export default function CategorySections({ categories, onSelect }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const liveNames = useMemo(() => new Set(categories.map((c) => c.name)), [categories]);

  return (
    <View>
      {SECTION_GROUPS.map((group) => {
        const tiles = group.tiles.filter((t) => liveNames.has(t.category));
        if (tiles.length === 0) return null;

        return (
          <View key={group.title} style={styles.section}>
            <Text weight="bold" color={Colors.textPrimary} style={styles.sectionTitle}>
              {group.title}
            </Text>
            <View style={styles.grid}>
              {tiles.map((tile) => (
                <TouchableOpacity
                  key={tile.label}
                  style={styles.tile}
                  activeOpacity={0.85}
                  onPress={() => onSelect(tile.category)}
                >
                  <View style={styles.imageBox}>
                    <RNText style={styles.emoji}>{tile.emoji}</RNText>
                  </View>
                  <Text
                    weight="medium"
                    color={Colors.textPrimary}
                    numberOfLines={2}
                    style={styles.label}
                  >
                    {tile.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    section: { marginTop: 18 },
    sectionTitle: { fontSize: 17, lineHeight: 22, marginHorizontal: HPAD, marginBottom: 12 },
    grid: {
      flexDirection: 'row',
      flexWrap:      'wrap',
      paddingHorizontal: HPAD,
      gap:           GAP,
    },
    tile: { width: TILE_W, marginBottom: 4 },
    imageBox: {
      width: TILE_W, height: TILE_W,
      borderRadius: 16,
      backgroundColor: Colors.surfaceAlt,
      justifyContent: 'center', alignItems: 'center',
    },
    emoji: { fontSize: 32, lineHeight: 40 },
    label: { fontSize: 11, lineHeight: 14, marginTop: 6, textAlign: 'center', minHeight: 28 },
  });
