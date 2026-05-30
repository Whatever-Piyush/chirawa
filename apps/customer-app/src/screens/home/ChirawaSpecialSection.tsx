import React, { useEffect, useState } from 'react';
import {
  View, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useT } from '@chirawa/i18n';
import { Text, SectionContainer } from '../../components/ui';
import { Colors, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import type { RootStackParamList } from '../../navigation/AppNavigator';

// Signature section — famous local Chirawa vendors. This is the most
// distinctive surface of the app, so it gets the deep-red accent (not the
// standard orange) to feel premium.
//
// Now wired to the live catalog: shops come from `api.getShops()` and each card
// opens ShopDetailScreen. The trailing "Add your local shop" CTA is the only
// translated card (isPlaceholder → copy from i18n, no Order Now).

// Shape of the catalog/shops list items we actually use here.
interface ApiShop {
  id:                       string;
  name:                     string;
  description:              string | null;
  estimatedDeliveryMinutes: number;
  isCurrentlyOpen:          boolean;
}

// Header-band fills, cycled per card so the carousel stays colorful.
const CARD_COLORS = ['#FFE4B5', '#E8F5E9', '#FCE4EC', '#E3F2FD', '#FFF3E0', '#F3E5F5'];

// Pick a fitting emoji from the shop name (no emoji column in the schema).
function emojiFor(name: string): string {
  if (/mithai|misthan|sweet|halwa|bhandar/i.test(name)) return '🍬';
  if (/saag|rotta|roti|dhaba|bhojan/i.test(name))       return '🍛';
  if (/fresh|mart|sabzi|veg|fruit/i.test(name))         return '🥬';
  return '🏪';
}

const CARD_WIDTH  = 170;
const CARD_HEIGHT = 210;
const HEADER_H    = 100;

interface CardProps {
  name:        string;
  famous:      string;
  badge:       string;
  orderNow:    string;
  emoji:       string;
  colorBg:     string;
  isPlaceholder?: boolean;
  onPress:     () => void;
}

function ShopCard({ name, famous, badge, orderNow, emoji, colorBg, isPlaceholder, onPress }: CardProps) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      {/* Colored header band with the shop emoji.
          TODO: swap for <Image source={{ uri: shop.logoUrl }} /> when shop
          photos land — keep the colorBg as the loading/fallback fill. */}
      <View style={[styles.cardHeader, { backgroundColor: colorBg }]}>
        <Text style={styles.cardEmoji}>{emoji}</Text>
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
            {famous}
          </Text>

          <View style={styles.badge}>
            <Text weight="semibold" color={Colors.specialAccent} style={styles.badgeText}>
              ★ {badge}
            </Text>
          </View>
        </View>

        {/* Order Now only for real, orderable shops. */}
        {!isPlaceholder && (
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
}

export default function ChirawaSpecialSection({ onSeeAll }: Props) {
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [shops, setShops]     = useState<ApiShop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.getShops() as ApiShop[];
        if (active) setShops(Array.isArray(data) ? data : []);
      } catch {
        if (active) setShops([]);   // tolerate — section just shows the CTA
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

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
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.specialAccent} />
          </View>
        ) : (
          shops.map((shop, i) => (
            <ShopCard
              key={shop.id}
              name={shop.name}
              famous={
                shop.description?.trim()
                  ? shop.description
                  : `${shop.estimatedDeliveryMinutes}-min delivery`
              }
              badge={t('home.specialBadgeLegend')}
              orderNow={t('home.specialOrderNow')}
              emoji={emojiFor(shop.name)}
              colorBg={CARD_COLORS[i % CARD_COLORS.length]}
              onPress={() => navigation.navigate('ShopDetail', { shopId: shop.id, shopName: shop.name })}
            />
          ))
        )}

        {/* Trailing "Add your local shop" CTA — always shown. */}
        <ShopCard
          name={t('home.addShopName')}
          famous={t('home.addShopDesc')}
          badge={t('common.comingSoon')}
          orderNow=""
          emoji="🏪"
          colorBg="#E8F5E9"
          isPlaceholder
          onPress={() => { /* no-op — onboarding flow TBD */ }}
        />
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
  loading: {
    width:          CARD_WIDTH,
    height:         CARD_HEIGHT,
    justifyContent: 'center',
    alignItems:     'center',
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
