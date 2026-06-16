import React from 'react';
import {
  View, Image, FlatList, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { Text } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import type { BestsellerCluster } from '../../services/catalog';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// "Bestsellers" — image-1 design (see 1.md): 3-col cards, each a 2×2 cluster of
// up to 4 real in-stock product images + a 2-line category name. Chirawa-skinned.
// No "+N more" counts, eggs excluded (both server-side). Missing cluster slots
// render a themed placeholder tile — never a broken image. Presentational.
//
// Layout matches CategorySections (HPAD 16 · GAP 10 · title 17/marginTop 18) so
// the section lines up consistently with the Grocery & Kitchen grids below it.
const PALETTE = ['#FFF8E1', '#FFF0F5', '#E8F5E9', '#FFF5EE', '#F3F0FF', '#E6F7F4'];

const HPAD  = 16;
const GAP   = 10;
const COLS  = 3;
const CARD_W   = Math.floor((SCREEN_WIDTH - HPAD * 2 - GAP * (COLS - 1)) / COLS);
const INNER_PAD = 8;
const TILE_GAP  = 6;
const TILE_W    = Math.floor((CARD_W - INNER_PAD * 2 - TILE_GAP) / 2);
const LABEL_LINE   = 16;
const LABEL_HEIGHT = LABEL_LINE * 2;

interface CardProps {
  cluster: BestsellerCluster;
  bg:      string;
  onPress: () => void;
}

function ClusterCard({ cluster, bg, onPress }: CardProps) {
  const { colors: Colors } = useTheme();
  // Always 4 slots → real image or a themed placeholder tile (no "and more").
  const slots = [0, 1, 2, 3].map((i) => cluster.images[i] ?? null);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.card, { backgroundColor: bg }]}>
      <View style={styles.cluster}>
        {slots.map((url, i) => (
          <View key={i} style={[styles.tile, !url && { backgroundColor: Colors.surfaceAlt }]}>
            {url ? <Image source={{ uri: url }} style={styles.tileImg} resizeMode="contain" /> : null}
          </View>
        ))}
      </View>

      <Text weight="medium" color={Colors.textPrimary} numberOfLines={2} style={styles.label}>
        {cluster.name}
      </Text>
    </TouchableOpacity>
  );
}

interface Props {
  clusters: BestsellerCluster[];
  onSelect: (name: string) => void;
}

function BestsellersSection({ clusters, onSelect }: Props) {
  const { colors: Colors } = useTheme();
  if (clusters.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text weight="bold" color={Colors.textPrimary} style={styles.sectionTitle}>
        Bestsellers
      </Text>
      <FlatList
        data={clusters}
        keyExtractor={(c) => c.name}
        numColumns={COLS}
        scrollEnabled={false}                /* lives inside HomeScreen's ScrollView */
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item, index }) => (
          <ClusterCard
            cluster={item}
            bg={PALETTE[index % PALETTE.length]}
            onPress={() => onSelect(item.name)}
          />
        )}
      />
    </View>
  );
}

// Memoised — re-renders only when the clusters / handler change.
export default React.memo(BestsellersSection);

const styles = StyleSheet.create({
  // Mirror CategorySections so titles + left edges line up across the home page.
  section:      { marginTop: 18 },
  sectionTitle: { fontSize: 17, lineHeight: 22, marginHorizontal: HPAD, marginBottom: 12 },
  grid:         { paddingHorizontal: HPAD, rowGap: 12 },
  row:          { gap: GAP, justifyContent: 'flex-start' },
  card: {
    width:        CARD_W,
    borderRadius: 16,
    borderWidth:  1,
    borderColor:  'rgba(0,0,0,0.05)',
    padding:      INNER_PAD,
    overflow:     'hidden',
  },
  cluster: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    width:         TILE_W * 2 + TILE_GAP,
    gap:           TILE_GAP,
    alignSelf:     'center',
    marginBottom:  8,
  },
  tile: {
    width:          TILE_W,
    height:         TILE_W,
    borderRadius:   8,
    backgroundColor:'#FFFFFF',
    overflow:       'hidden',
    justifyContent: 'center',
    alignItems:     'center',
  },
  tileImg: { width: '88%', height: '88%' },
  label:   { fontSize: 12, lineHeight: LABEL_LINE, height: LABEL_HEIGHT },
});
