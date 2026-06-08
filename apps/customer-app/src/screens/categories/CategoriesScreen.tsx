import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AddressResponse } from '@chirawa/types';
import { Text } from '../../components/ui';
import { Spacing, Radius } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { fetchCategories, type ApiCategory } from '../../services/catalog';
import { api } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';
import Header from '../home/Header';
import SearchBar from '../home/SearchBar';
import ClosedBanner from '../home/ClosedBanner';
import { useStoreClosed } from '../../hooks/useStoreClosed';
import LocationSheet from '../../components/location/LocationSheet';
import type { RootStackParamList } from '../../navigation/AppNavigator';

// Stagger + duration for the slow "rise from the bottom" entrance of each row.
const RISE_STAGGER_MS = 70;
const RISE_DURATION   = 520;
const RISE_OFFSET     = 26;   // px each row travels up as it fades in

// ─── Single category row with a slow fade-up entrance ──────────────────────────

function CategoryRow({
  item, index, onPress, styles, Colors,
}: {
  item: ApiCategory;
  index: number;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  Colors: ColorPalette;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(RISE_OFFSET)).current;

  useEffect(() => {
    // Cap the stagger so a long list doesn't take forever to settle.
    const delay = Math.min(index, 9) * RISE_STAGGER_MS;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: RISE_DURATION, delay,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0, duration: RISE_DURATION, delay,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, index]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={onPress}>
        <View style={styles.thumb}>
          {item.imageUrl
            ? <Image source={{ uri: item.imageUrl }} style={styles.thumbImg} resizeMode="contain" />
            : <View style={[styles.thumbImg, { backgroundColor: Colors.primaryLight }]} />}
        </View>
        <View style={styles.info}>
          <Text weight="semibold" color={Colors.textPrimary} numberOfLines={1} style={styles.name}>
            {item.name}
          </Text>
          <Text weight="regular" color={Colors.textSecondary} style={styles.count}>
            {item.productCount} item{item.productCount === 1 ? '' : 's'}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Categories tab — Home-style header + sticky search + saved-address sheet ──

export default function CategoriesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state } = useAuth();
  const closed = useStoreClosed();

  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [loading, setLoading]       = useState(true);
  const [addresses, setAddresses]   = useState<AddressResponse[]>([]);
  const [sheetOpen, setSheetOpen]   = useState(false);

  // Header entrance (header + search fade in together, then the list rises).
  const headerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    fetchCategories()
      .then((c) => { if (active) setCategories(c); })
      .catch(() => { /* tolerate */ })
      .finally(() => { if (active) setLoading(false); });
    Animated.timing(headerOpacity, {
      toValue: 1, duration: 300, useNativeDriver: true,
    }).start();
    return () => { active = false; };
  }, [headerOpacity]);

  const loadAddresses = useCallback(async () => {
    try {
      const data = await api.getAddresses();
      data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setAddresses(data);
    } catch {
      /* tolerate */
    }
  }, []);

  useEffect(() => { void loadAddresses(); }, [loadAddresses]);
  useEffect(
    () => navigation.addListener('focus', () => { void loadAddresses(); }),
    [navigation, loadAddresses],
  );

  const activeAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const addressLine = activeAddress
    ? `${activeAddress.street}, ${activeAddress.locality}`
    : null;

  return (
    <View style={styles.container}>
      {/* Same delivery-ETA + address header as Home */}
      <Header
        entranceOpacity={headerOpacity}
        addressLine={addressLine}
        night={closed}
        onProfilePress={() => navigation.navigate('MainTabs', { screen: 'Profile' })}
        onLocationPress={() => setSheetOpen(true)}
      />

      {/* Sticky search bar — straddles the orange/cream boundary, never scrolls */}
      <View style={styles.searchOverlap}>
        <SearchBar
          entranceOpacity={headerOpacity}
          onPress={() => navigation.navigate('Search')}
        />
      </View>

      {closed && <ClosedBanner />}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <CategoryRow
              item={item}
              index={index}
              styles={styles}
              Colors={Colors}
              onPress={() => navigation.navigate('CategoryProducts', { category: item.name })}
            />
          )}
        />
      )}

      <LocationSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        addresses={addresses}
        userName={state.name}
        userPhone={state.phone}
        onChanged={loadAddresses}
      />
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  // Pull the SearchBar up into the orange header's bottom padding (matches Home).
  searchOverlap: { marginTop: -20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:   { padding: Spacing.lg, gap: 10, paddingBottom: Spacing.xxxl },
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         10,
    gap:             12,
  },
  thumb: {
    width: 52, height: 52, borderRadius: 10,
    backgroundColor: Colors.white, overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
  },
  thumbImg: { width: '100%', height: '100%' },
  info:  { flex: 1 },
  name:  { fontSize: 15, lineHeight: 19 },
  count: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
