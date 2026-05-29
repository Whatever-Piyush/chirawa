import React from 'react';
import {
  View, FlatList, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { useT } from '@chirawa/i18n';
import { Text, SectionContainer } from '../../components/ui';
import { Colors, Spacing } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Each category gets a soft pastel bg + a slightly darker companion tone used
// for the 1px border AND for the 2x2 product placeholders. Hand-tuned per
// category so the placeholder squares "echo" the card colour without being
// obnoxiously bright. `overflow` is the "+N more" badge count.
interface BestsellerCategory {
  id:        string;
  labelKey:  string;
  bg:        string;
  tone:      string;
  overflow:  number;
}

const CATEGORIES: ReadonlyArray<BestsellerCategory> = [
  { id: 'munchies', labelKey: 'home.bsMunchies', bg: '#FFF8E1', tone: '#F5E5A8', overflow: 1171 },
  { id: 'icecream', labelKey: 'home.bsIceCream', bg: '#FFF0F5', tone: '#FAD4E0', overflow: 412  },
  { id: 'dairy',    labelKey: 'home.bsDairy',    bg: '#E8F5E9', tone: '#C5E0C7', overflow: 214  },
  { id: 'grocery',  labelKey: 'home.bsGrocery',  bg: '#FFF5EE', tone: '#F5DCC4', overflow: 386  },
  { id: 'instant',  labelKey: 'home.bsInstant',  bg: '#F3F0FF', tone: '#DAD0F0', overflow: 168  },
];

// Geometry derived from the spec: 3 columns inside the section's 16-px
// horizontal padding, with 2 inter-column gaps. Cards are slightly taller
// than wide (≈1:1.1) — the inner grid + label fit comfortably.
const SECTION_HPAD = 16;
const CARD_GAP     = 8;
const CARD_WIDTH   = Math.floor((SCREEN_WIDTH - SECTION_HPAD * 2 - CARD_GAP * 2) / 3);
const CARD_HEIGHT  = Math.round(CARD_WIDTH * 1.1);
const TILE_SIZE    = 32;   // 36 in the spec; we trim a touch so 2×2 + gap fits the smaller column widths

interface CardProps {
  category: BestsellerCategory;
  label:    string;
  moreWord: string;
  onPress:  () => void;
}

function BestsellerCard({ category, label, moreWord, onPress }: CardProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.card,
        { backgroundColor: category.bg, borderColor: category.tone },
      ]}
    >
      {/* 2×2 product placeholder grid. Each tile is a slightly darker shade
          of the card so the texture echoes the colour instead of fighting
          it. TODO when product images land: swap to <Image source={...} />. */}
      <View style={styles.tilesGrid}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[styles.tile, { backgroundColor: category.tone }]}
          />
        ))}
      </View>

      <Text
        color={Colors.textSecondary}
        style={styles.moreText}
      >
        +{category.overflow} {moreWord}
      </Text>

      <Text
        weight="semibold"
        color={Colors.textPrimary}
        numberOfLines={2}
        style={styles.label}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface Props {
  onSeeAll?: () => void;
  onSelect?: (id: string) => void;
}

export default function BestsellersSection({ onSeeAll, onSelect }: Props) {
  const t = useT();
  const moreWord = t('home.bsMore');

  return (
    <SectionContainer title={t('home.bestsellers')} onSeeAll={onSeeAll}>
      <FlatList
        data={CATEGORIES.slice()}
        keyExtractor={(item) => item.id}
        numColumns={3}
        scrollEnabled={false}                /* lives inside HomeScreen's ScrollView */
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <BestsellerCard
            category={item}
            label={t(item.labelKey)}
            moreWord={moreWord}
            onPress={() => onSelect?.(item.id)}
          />
        )}
      />
    </SectionContainer>
  );
}

const styles = StyleSheet.create({
  grid: {
    paddingHorizontal: SECTION_HPAD,
    rowGap:            CARD_GAP,
  },
  row: {
    gap:            CARD_GAP,
    justifyContent: 'flex-start',
    /* 5 items in a 3-column grid leaves the second row with 2 cards
       aligned to the left — fine; reads as "more bestsellers below". */
  },
  card: {
    width:        CARD_WIDTH,
    height:       CARD_HEIGHT,
    borderRadius: 14,
    borderWidth:  1,
    paddingHorizontal: 10,
    paddingVertical:   10,
    justifyContent:    'space-between',
  },
  tilesGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    width:         TILE_SIZE * 2 + 4,
    gap:           4,
  },
  tile: {
    width:        TILE_SIZE,
    height:       TILE_SIZE,
    borderRadius: 8,
  },
  moreText: {
    fontSize: 10,
  },
  label: {
    fontSize:   12,
    lineHeight: 15,
  },
});
