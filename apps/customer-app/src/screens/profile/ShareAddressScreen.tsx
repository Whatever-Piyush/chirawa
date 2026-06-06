import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AddressResponse } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import { kmFromChirawa } from '../../utils/geo';

type Props = NativeStackScreenProps<RootStackParamList, 'ShareAddress'>;

// The payload we send back to the requester via a bringly://receive-address link.
function buildReturnLink(addr: AddressResponse): string {
  const payload = {
    label:    addr.label ?? null,
    street:   addr.street,
    landmark: addr.landmark,
    locality: addr.locality,
    city:     addr.city,
    pincode:  addr.pincode,
    lat:      addr.lat,
    lng:      addr.lng,
  };
  return `bringly://receive-address?payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

export default function ShareAddressScreen({ route, navigation }: Props) {
  const t      = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state } = useAuth();

  const fromName = route.params?.from ?? null;
  const toPhone  = route.params?.phone ?? null;

  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.getAddresses();
      data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setAddresses(data);
      // Pre-select the default so Share is reachable in one tap.
      setSelectedId((cur) => cur ?? data.find((a) => a.isDefault)?.id ?? data[0]?.id ?? null);
    } catch {
      /* tolerate */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => navigation.addListener('focus', () => { void load(); }), [navigation, load]);

  const selected = addresses.find((a) => a.id === selectedId) ?? null;

  const handleShare = () => {
    if (!selected) return;
    const link = buildReturnLink(selected);
    const text = encodeURIComponent(`${t('shareAddress.sendMessage')}\n${link}`);
    const url = toPhone
      ? `https://wa.me/${toPhone.replace(/[^0-9]/g, '')}?text=${text}`
      : `https://wa.me/?text=${text}`;
    void Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={styles.container}>
      {/* Illustration header */}
      <View style={[styles.hero, { paddingTop: insets.top + Spacing.md }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.pinWrap}>
          <Ionicons name="location-sharp" size={88} color={Colors.primary} />
        </View>
      </View>

      <Text style={styles.title}>{t('shareAddress.title')}</Text>
      {fromName ? (
        <Text style={styles.subtitle}>
          <Text style={styles.subtitleName}>{fromName}</Text> {t('shareAddress.requestedBy')}
        </Text>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {/* Add new address */}
        <TouchableOpacity
          style={styles.addRow}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('AddressMap')}
        >
          <Ionicons name="add" size={22} color={Colors.primary} />
          <Text style={styles.addText}>{t('shareAddress.addNew')}</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>
        ) : (
          addresses.map((item) => {
            const isSel = item.id === selectedId;
            const km = kmFromChirawa(item.lat, item.lng);
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.addrCard, isSel && styles.addrCardActive]}
                activeOpacity={0.85}
                onPress={() => setSelectedId(item.id)}
              >
                <View style={styles.labelTile}>
                  <Ionicons name="location" size={20} color={Colors.warning} />
                </View>
                <View style={styles.addrBody}>
                  <View style={styles.addrNameRow}>
                    <Text style={styles.addrName} numberOfLines={1}>
                      {state.name ?? (item.label ?? 'Address')}
                    </Text>
                    <Text style={styles.addrKm}>{km.toFixed(2)} {t('shareAddress.kmAway')}</Text>
                  </View>
                  <Text style={styles.addrText} numberOfLines={2}>
                    {item.street}, {item.locality}{item.city ? `, ${item.city}` : ''}
                  </Text>
                </View>
                <Ionicons
                  name={isSel ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={isSel ? Colors.success : Colors.textTertiary}
                />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Share button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <TouchableOpacity
          style={[styles.shareBtn, !selected && styles.shareBtnDisabled]}
          activeOpacity={0.85}
          disabled={!selected}
          onPress={handleShare}
        >
          <Text style={styles.shareBtnText}>{t('shareAddress.shareBtn')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    hero: {
      backgroundColor: Colors.primaryLight,
      paddingBottom: Spacing.xxl,
      alignItems: 'center',
    },
    backBtn: {
      position: 'absolute', left: Spacing.lg, top: Spacing.lg, zIndex: 2,
      width: 40, height: 40, borderRadius: Radius.full,
      backgroundColor: Colors.surface,
      alignItems: 'center', justifyContent: 'center',
      ...Shadow.sm,
    },
    pinWrap: { marginTop: Spacing.xl, alignItems: 'center', justifyContent: 'center' },

    title: {
      fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary,
      textAlign: 'center', marginTop: Spacing.xl, paddingHorizontal: Spacing.lg, lineHeight: 28,
    },
    subtitle: {
      fontSize: FontSize.sm, color: Colors.textSecondary,
      textAlign: 'center', marginTop: Spacing.xs,
    },
    subtitleName: { fontWeight: FontWeight.bold, color: Colors.primary },

    list: { padding: Spacing.lg, gap: Spacing.md },

    addRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: Spacing.lg, minHeight: 58,
      ...Shadow.xs,
    },
    addText: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.primary },

    addrCard: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
      padding: Spacing.lg,
      ...Shadow.xs,
    },
    addrCardActive: { borderColor: Colors.primary, borderWidth: 1.5 },
    labelTile: {
      width: 40, height: 40, borderRadius: Radius.md,
      backgroundColor: Colors.warningLight,
      alignItems: 'center', justifyContent: 'center',
    },
    addrBody: { flex: 1, gap: 2 },
    addrNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    addrName: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary, flexShrink: 1 },
    addrKm:   { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.info },
    addrText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },

    loading: { paddingVertical: Spacing.xl, alignItems: 'center' },

    footer: {
      paddingHorizontal: Spacing.lg, paddingTop: Spacing.md,
      backgroundColor: Colors.surface,
      borderTopWidth: 1, borderTopColor: Colors.border,
    },
    shareBtn: {
      backgroundColor: Colors.primary, borderRadius: Radius.md,
      minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center',
    },
    shareBtnDisabled: { backgroundColor: Colors.disabled },
    shareBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  });
