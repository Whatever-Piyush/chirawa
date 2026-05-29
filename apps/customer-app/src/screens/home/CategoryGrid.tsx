import React from 'react';
import {
  View, FlatList, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text, SectionContainer } from '../../components/ui';
import { Colors } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface CategoryTileData {
  id:        string;
  labelKey:  string;
  icon:      React.ComponentProps<typeof Ionicons>['name'];
  bg:        string;   // placeholder square fill (pastel)
  iconColor: string;   // icon tint (darker companion of bg)
}

// ── Grocery & Kitchen — 6 tiles ──────────────────────────────────────────────
// Chicken/Meat/Fish and Kitchenware/Appliances intentionally excluded per spec.
export const GROCERY_KITCHEN: ReadonlyArray<CategoryTileData> = [
  { id: 'veg-fruits', labelKey: 'home.gkVegFruits',  icon: 'leaf-outline',       bg: '#E8F5E9', iconColor: '#4CAF50' },
  { id: 'atta',       labelKey: 'home.gkAtta',       icon: 'restaurant-outline', bg: '#FFF6E0', iconColor: '#E0A422' },
  { id: 'oil',        labelKey: 'home.gkOil',        icon: 'flame-outline',      bg: '#FFEEE6', iconColor: '#FF6B35' },
  { id: 'dairy',      labelKey: 'home.gkDairyBread', icon: 'egg-outline',        bg: '#E8F2FE', iconColor: '#4A90D9' },
  { id: 'bakery',     labelKey: 'home.gkBakery',     icon: 'cafe-outline',       bg: '#F3EADF', iconColor: '#B07B4F' },
  { id: 'dryfruits',  labelKey: 'home.gkDryFruits',  icon: 'nutrition-outline',  bg: '#F3F0FF', iconColor: '#8B6FD0' },
];

// ── Snacks & Drinks — 7 tiles ────────────────────────────────────────────────
// Paan Corner intentionally excluded per spec.
export const SNACKS_DRINKS: ReadonlyArray<CategoryTileData> = [
  { id: 'chips',    labelKey: 'home.sdChips',    icon: 'fast-food-outline', bg: '#FFF8E1', iconColor: '#E0A422' },
  { id: 'sweets',   labelKey: 'home.sdSweets',   icon: 'gift-outline',      bg: '#FFF0F5', iconColor: '#D6789E' },
  { id: 'drinks',   labelKey: 'home.sdDrinks',   icon: 'wine-outline',      bg: '#FFECEC', iconColor: '#E2574C' },
  { id: 'tea',      labelKey: 'home.sdTea',      icon: 'cafe-outline',      bg: '#F3EADF', iconColor: '#B07B4F' },
  { id: 'instant',  labelKey: 'home.sdInstant',  icon: 'pizza-outline',     bg: '#FFEEE6', iconColor: '#FF6B35' },
  { id: 'sauces',   labelKey: 'home.sdSauces',   icon: 'water-outline',     bg: '#E6F7F4', iconColor: '#2BA89A' },
  { id: 'icecream', labelKey: 'home.sdIceCream', icon: 'ice-cream-outline', bg: '#F3F0FF', iconColor: '#8B6FD0' },
];

// ── Tile geometry ────────────────────────────────────────────────────────────
// 4 columns inside the section's 16-px horizontal padding, 3 gaps of 8.
const SECTION_HPAD = 16;
const COL_GAP      = 8;
const TILE_WIDTH   = Math.floor((SCREEN_WIDTH - SECTION_HPAD * 2 - COL_GAP * 3) / 4);
const PLACEHOLDER  = 56;
const LABEL_LINE   = 14;
const LABEL_HEIGHT = LABEL_LINE * 2;   // reserve 2 lines so every tile is equal height

interface TileProps {
  item:    CategoryTileData;
  label:   string;
  onPress: () => void;
}

function CategoryTile({ item, label, onPress }: TileProps) {
  return (
    <TouchableOpacity style={styles.tile} activeOpacity={0.8} onPress={onPress}>
      {/* Colored image placeholder. TODO when category artwork lands:
          replace the icon with <Image source={{ uri: item.imageUrl }} />. */}
      <View style={[styles.placeholder, { backgroundColor: item.bg }]}>
        <Ionicons name={item.icon} size={28} color={item.iconColor} />
      </View>
      <Text
        weight="medium"
        color={Colors.textPrimary}
        align="center"
        numberOfLines={2}
        style={styles.label}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface Props {
  title:    string;
  items:    ReadonlyArray<CategoryTileData>;
  onSeeAll?: () => void;
  onSelect?: (id: string) => void;
}

// Reusable 4-column icon-tile grid. Instantiated twice on Home (Grocery &
// Kitchen, Snacks & Drinks). scrollEnabled=false so it nests inside the
// HomeScreen ScrollView.
export default function CategoryGrid({ title, items, onSeeAll, onSelect }: Props) {
  const t = useT();
  return (
    <SectionContainer title={title} onSeeAll={onSeeAll}>
      <FlatList
        data={items.slice()}
        keyExtractor={(item) => item.id}
        numColumns={4}
        scrollEnabled={false}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <CategoryTile
            item={item}
            label={t(item.labelKey)}
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
    rowGap:            12,
  },
  row: {
    gap:            COL_GAP,
    justifyContent: 'flex-start',
  },
  tile: {
    width:             TILE_WIDTH,
    backgroundColor:   Colors.surface,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       Colors.border,
    padding:           10,
    alignItems:        'center',
  },
  placeholder: {
    width:          PLACEHOLDER,
    height:         PLACEHOLDER,
    borderRadius:   10,
    justifyContent: 'center',
    alignItems:     'center',
  },
  label: {
    fontSize:   11,
    lineHeight: LABEL_LINE,
    height:     LABEL_HEIGHT,
    marginTop:  8,
  },
});
