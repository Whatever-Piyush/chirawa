import React, { useMemo } from 'react';
import { View, Image, Text as RNText, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Text } from '../../components/ui';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import type { ApiCategory } from '../../services/catalog';
import { SECTION_GROUPS } from './categoryMeta';

interface Props {
  categories:        ApiCategory[];
  onSelect:          (name: string) => void;
  imagesByCategory?: Record<string, string[]>;   // real product images per category (image-2 / 2.md)
  exclude?:          string[];                    // category names to hide on this surface
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
export default function CategorySections({ categories, onSelect, imagesByCategory, exclude }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const liveNames = useMemo(() => new Set(categories.map((c) => c.name)), [categories]);
  const hide = useMemo(() => new Set(exclude ?? []), [exclude]);

  return (
    <View>
      {SECTION_GROUPS.map((group) => {
        const tiles = group.tiles.filter((t) => liveNames.has(t.category) && !hide.has(t.category));
        if (tiles.length === 0) return null;

        return (
          <View key={group.title} style={styles.section}>
            <Text weight="bold" color={Colors.textPrimary} style={styles.sectionTitle}>
              {group.title}
            </Text>
            <View style={styles.grid}>
              {tiles.map((tile) => {
                // Real product images for this category (image-2); else the emoji.
                const imgs = (imagesByCategory?.[tile.category] ?? []).slice(0, 3);
                return (
                  <TouchableOpacity
                    key={tile.label}
                    style={styles.tile}
                    activeOpacity={0.85}
                    onPress={() => onSelect(tile.category)}
                  >
                    <View style={styles.imageBox}>
                      {imgs.length > 0 ? (
                        <View style={styles.collage}>
                          {imgs.map((url, i) => (
                            <Image key={i} source={{ uri: url }} style={styles.collageImg} resizeMode="contain" />
                          ))}
                        </View>
                      ) : (
                        <RNText style={styles.emoji}>{tile.emoji}</RNText>
                      )}
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
                );
              })}
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
    // Real-image collage (image-2): 1 image fills; 2–3 share the row evenly.
    collage: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      width: '100%', height: '100%', paddingHorizontal: 6, gap: 3,
    },
    collageImg: { flex: 1, height: '74%' },
    // Unified home card/tile label scale (matches Bestsellers + product cards): 12 / medium.
    label: { fontSize: 12, lineHeight: 16, marginTop: 6, textAlign: 'center', minHeight: 32 },
  });
