import React from 'react';
import {
  View, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useT } from '@chirawa/i18n';
import { Text, SectionContainer } from '../../components/ui';
import { Colors, Spacing } from '../../theme';

// Signature section — famous local Chirawa vendors. This is the most
// distinctive surface of the app, so it gets the deep-red accent (not the
// standard orange) to feel premium.
//
// Seed data is hardcoded for now; real shops will arrive from the API later
// with the same shape (plain `name` / `famousFor` strings). The only
// translated card is the trailing "Add your local shop" CTA — flagged with
// isPlaceholder so its copy is pulled from i18n while real shops stay literal.
export interface SpecialShop {
  id:            string;
  name:          string;
  famousFor:     string;
  emoji:         string;
  badgeKey:      string;   // i18n key for the ★ badge
  colorBg:       string;   // header band fill
  isPlaceholder?: boolean; // true → CTA card (name/desc from i18n, no Order Now)
}

export const SPECIAL_SHOPS: ReadonlyArray<SpecialShop> = [
  {
    id:        'lalchand',
    name:      'Lalchand Mithai Wale',
    famousFor: 'Peda & Sweets',
    emoji:     '🍬',
    badgeKey:  'home.specialBadgeLegend',
    colorBg:   '#FFE4B5',
  },
  // Add more as the client provides shop names — same shape as above.
  {
    id:            'add-shop',
    name:          '',                 // resolved from i18n at render
    famousFor:     '',
    emoji:         '🏪',
    badgeKey:      'common.comingSoon',
    colorBg:       '#E8F5E9',
    isPlaceholder: true,
  },
];

const CARD_WIDTH  = 170;
const CARD_HEIGHT = 210;
const HEADER_H    = 100;

interface CardProps {
  shop:     SpecialShop;
  name:     string;
  famous:   string;
  famousLabel: string;
  badge:    string;
  orderNow: string;
  onPress:  () => void;
}

function ShopCard({ shop, name, famous, famousLabel, badge, orderNow, onPress }: CardProps) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      {/* Colored header band with the shop emoji.
          TODO: swap for <Image source={{ uri: shop.logoUrl }} /> when shop
          photos land — keep the colorBg as the loading/fallback fill. */}
      <View style={[styles.cardHeader, { backgroundColor: shop.colorBg }]}>
        <Text style={styles.cardEmoji}>{shop.emoji}</Text>
      </View>

      <View style={styles.cardBody}>
        <View>
          <Text
            weight="semibold"
            color={Colors.textPrimary}
            numberOfLines={1}
            style={styles.cardName}
          >
            {name}
          </Text>
          <Text
            weight="regular"
            color={Colors.textSecondary}
            numberOfLines={1}
            style={styles.cardFamous}
          >
            {shop.isPlaceholder ? famous : `${famousLabel} ${famous}`}
          </Text>

          <View style={styles.badge}>
            <Text weight="semibold" color={Colors.specialAccent} style={styles.badgeText}>
              ★ {badge}
            </Text>
          </View>
        </View>

        {/* Order Now only for real, orderable shops. */}
        {!shop.isPlaceholder && (
          <Text weight="semibold" color={Colors.specialAccent} style={styles.orderNow}>
            {orderNow}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

interface Props {
  onSeeAll?: () => void;
  onSelect?: (id: string) => void;
}

export default function ChirawaSpecialSection({ onSeeAll, onSelect }: Props) {
  const t = useT();

  return (
    <SectionContainer
      title={t('home.specialTitle')}
      subtitle={t('home.specialSubtitle')}
      seeAllColor={Colors.specialAccent}
      onSeeAll={onSeeAll}
      headerStyle={styles.headerStrip}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {SPECIAL_SHOPS.map((shop) => (
          <ShopCard
            key={shop.id}
            shop={shop}
            name={shop.isPlaceholder ? t('home.addShopName') : shop.name}
            famous={shop.isPlaceholder ? t('home.addShopDesc') : shop.famousFor}
            famousLabel={t('home.specialFamousFor')}
            badge={t(shop.badgeKey)}
            orderNow={t('home.specialOrderNow')}
            onPress={() => onSelect?.(shop.id)}
          />
        ))}
      </ScrollView>
    </SectionContainer>
  );
}

const styles = StyleSheet.create({
  // Full-width tinted strip behind the section header (bg fills the row;
  // the 16-px horizontal padding insets the text). paddingVertical lifts it
  // into a proper band per spec §8.
  headerStrip: {
    backgroundColor: Colors.special,
    paddingVertical: 14,
    marginBottom:    Spacing.lg,
  },
  scroll: {
    paddingHorizontal: Spacing.lg,
    gap:               12,
  },
  card: {
    width:           CARD_WIDTH,
    height:          CARD_HEIGHT,
    backgroundColor: Colors.surface,
    borderRadius:    14,
    borderWidth:     1.5,
    borderColor:     Colors.specialBorder,
    overflow:        'hidden',
    // Soft orange-tinted lift per spec.
    shadowColor:   '#FF6B35',
    shadowOpacity: 0.12,
    shadowRadius:  6,
    shadowOffset:  { width: 0, height: 2 },
    elevation:     3,
  },
  cardHeader: {
    height:         HEADER_H,
    justifyContent: 'center',
    alignItems:     'center',
  },
  cardEmoji: {
    fontSize:   44,
    lineHeight: 52,
  },
  cardBody: {
    flex:           1,
    padding:        12,
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize:   13,
    lineHeight: 17,
  },
  cardFamous: {
    fontSize:   11,
    lineHeight: 15,
    marginTop:  2,
  },
  badge: {
    alignSelf:         'flex-start',
    backgroundColor:   Colors.special,
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      999,
    marginTop:         8,
  },
  badgeText: {
    fontSize:   10,
    lineHeight: 13,
  },
  orderNow: {
    fontSize:   12,
    lineHeight: 16,
  },
});
