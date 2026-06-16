import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Linking, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AddressResponse, PlacePrediction } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useAddresses } from '../../context/AddressContext';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import AddressCard from './AddressCard';
import AddressActionsSheet from './AddressActionsSheet';
import { usePlaceSearch } from './usePlaceSearch';
import { shareAddress } from '../../utils/shareAddress';

const WHATSAPP_GREEN = '#25D366';

interface Props {
  visible:    boolean;
  onClose:    () => void;
  userName:   string | null;
  userPhone:  string | null;
  // Checkout mode: hides search + "use current", routes Add-new back to Checkout.
  compact?:   boolean;
}

function labelChoiceOf(label: string | null | undefined): 'home' | 'work' | 'hotel' | 'other' {
  return label === 'घर' ? 'home' : label === 'दुकान' ? 'work' : label === 'होटल' ? 'hotel' : 'other';
}

export default function LocationSheet({
  visible, onClose, userName, userPhone, compact,
}: Props) {
  const t      = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { addresses, current, select, refresh } = useAddresses();
  const search = usePlaceSearch();
  const [menuFor, setMenuFor] = useState<AddressResponse | null>(null);

  const close = useCallback(() => { search.reset(); onClose(); }, [search, onClose]);

  const goToMap = () => { close(); navigation.navigate('AddressMap', { autoLocate: true }); };
  const goToAdd = () => { close(); navigation.navigate('AddressMap', compact ? { returnTo: 'Checkout' } : undefined); };

  // Pick a place prediction → resolve to coords → open the map centred there.
  const pickPrediction = async (p: PlacePrediction) => {
    const details = await search.resolve(p.placeId);
    close();
    navigation.navigate('AddressMap', {
      ...(details ? { center: { lat: details.lat, lng: details.lng } } : {}),
      ...(compact ? { returnTo: 'Checkout' as const } : {}),
    });
  };

  const requestFromOther = () => {
    const qs = [
      userName  ? `from=${encodeURIComponent(userName)}`   : null,
      userPhone ? `phone=${encodeURIComponent(userPhone)}` : null,
    ].filter(Boolean).join('&');
    const link = `bringly://share-address${qs ? `?${qs}` : ''}`;
    const msg  = encodeURIComponent(`${t('locationSheet.requestMessage')}\n${link}`);
    void Linking.openURL(`https://wa.me/?text=${msg}`).catch(() => {});
  };

  // Tapping a saved address (or its pin) makes it the active delivery address
  // EVERYWHERE — home header, categories, cart/checkout — via the global context.
  const selectAddress = async (item: AddressResponse) => {
    await select(item.id);
    close();
  };

  const setDefault = async (item: AddressResponse) => {
    if (item.id === current?.id) return;
    await select(item.id);
  };

  const editAddress = (a: AddressResponse) => {
    close();
    navigation.navigate('AddressDetails', {
      lat: a.lat, lng: a.lng,
      title: a.locality, subtitle: `${a.street}, ${a.locality}`,
      locality: a.locality, city: a.city, pincode: a.pincode,
      editId: a.id,
      initialHouse: a.street,
      initialLandmark: a.landmark && a.landmark !== '—' ? a.landmark : '',
      initialLabel: labelChoiceOf(a.label),
      receiverName: a.receiverName ?? undefined,
      receiverPhone: a.receiverPhone ?? undefined,
    });
  };

  const deleteAddress = async (a: AddressResponse) => {
    try { await api.deleteAddress(a.id); void refresh(); } catch { /* retry */ }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={close} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('locationSheet.selectTitle')}</Text>
            <TouchableOpacity onPress={close} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Search (functional place search; hidden in checkout/compact mode) */}
          {!compact && (
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={Colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                value={search.query}
                onChangeText={search.setQuery}
                placeholder={t('locationSheet.searchPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                returnKeyType="search"
                autoCorrect={false}
              />
              {search.query.length > 0 && (
                <TouchableOpacity onPress={() => search.setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            {search.active ? (
              // ── Search results (Chirawa-only) ──
              <View style={{ gap: Spacing.sm }}>
                {search.searching && search.predictions.length === 0 ? (
                  <View style={styles.searchingRow}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={styles.searchingText}>{t('locationSheet.searching')}</Text>
                  </View>
                ) : search.predictions.length === 0 ? (
                  <Text style={styles.noneText}>{t('locationSheet.noResults')}</Text>
                ) : (
                  search.predictions.map((p) => (
                    <PredictionRow key={p.placeId} p={p} onPress={() => void pickPrediction(p)} styles={styles} Colors={Colors} />
                  ))
                )}
              </View>
            ) : (
              <>
                {/* Quick actions */}
                <View style={styles.actionCard}>
                  {!compact && (
                    <>
                      <ActionRow icon="locate" iconColor={Colors.primary} label={t('locationSheet.useCurrent')} onPress={goToMap} styles={styles} Colors={Colors} />
                      <View style={styles.actionDivider} />
                    </>
                  )}
                  <ActionRow icon="add" iconColor={Colors.primary} label={t('locationSheet.addNew')} onPress={goToAdd} styles={styles} Colors={Colors} />
                  <View style={styles.actionDivider} />
                  <ActionRow icon="logo-whatsapp" iconColor={WHATSAPP_GREEN} label={t('locationSheet.requestOther')} onPress={requestFromOther} styles={styles} Colors={Colors} />
                </View>

                {/* Saved addresses */}
                <Text style={styles.savedHeading}>{t('locationSheet.savedTitle')}</Text>
                {addresses.length === 0 ? (
                  <Text style={styles.noneText}>{t('locationSheet.noneSaved')}</Text>
                ) : (
                  <View style={{ gap: Spacing.md }}>
                    {addresses.map((item) => (
                      <AddressCard
                        key={item.id}
                        address={item}
                        userName={userName}
                        userPhone={userPhone}
                        selected={item.id === current?.id}
                        onSelect={() => void selectAddress(item)}
                        onSetDefault={compact ? undefined : () => void setDefault(item)}
                        onShare={() => void shareAddress(item)}
                        onMore={compact ? undefined : () => setMenuFor(item)}
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>

      <AddressActionsSheet
        visible={!!menuFor}
        address={menuFor}
        onClose={() => setMenuFor(null)}
        onEdit={editAddress}
        onShare={(a) => void shareAddress(a)}
        onSetDefault={(a) => void setDefault(a)}
        onDelete={(a) => void deleteAddress(a)}
      />
    </Modal>
  );
}

// ─── Place prediction row (pin tile + distance + 2 lines) ──────────────────────

function PredictionRow({
  p, onPress, styles, Colors,
}: {
  p: PlacePrediction; onPress: () => void;
  styles: ReturnType<typeof makeStyles>; Colors: ColorPalette;
}) {
  return (
    <TouchableOpacity style={styles.predRow} activeOpacity={0.75} onPress={onPress}>
      <View style={styles.predTile}>
        <Ionicons name="location-outline" size={22} color={Colors.primary} />
        {p.distanceKm != null && (
          <Text style={styles.predDist}>{p.distanceKm} km</Text>
        )}
      </View>
      <View style={styles.predBody}>
        <Text style={styles.predPrimary} numberOfLines={1}>{p.primaryText}</Text>
        {!!p.secondaryText && <Text style={styles.predSecondary} numberOfLines={2}>{p.secondaryText}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── Quick-action row ──────────────────────────────────────────────────────────

function ActionRow({
  icon, iconColor, label, onPress, styles, Colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string; label: string; onPress: () => void;
  styles: ReturnType<typeof makeStyles>; Colors: ColorPalette;
}) {
  return (
    <TouchableOpacity style={styles.actionRow} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.actionIcon, { backgroundColor: `${iconColor}1A` }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    backdropTap: { flex: 1 },
    sheet: {
      backgroundColor: Colors.background,
      borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
      paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, maxHeight: '88%',
    },

    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
    title:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    closeBtn: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: Colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },

    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: Colors.surface,
      borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: Spacing.md, height: 50, ...Shadow.xs,
    },
    searchInput: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, padding: 0 },

    scroll: { paddingTop: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.lg },

    actionCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, ...Shadow.xs },
    actionRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, minHeight: 58 },
    actionIcon: { width: 38, height: 38, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
    actionLabel:{ flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
    actionDivider: { height: 1, backgroundColor: Colors.divider, marginLeft: 58 },

    savedHeading: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
    noneText:     { fontSize: FontSize.md, color: Colors.textTertiary, paddingVertical: Spacing.lg, textAlign: 'center' },

    searchingRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
    searchingText: { fontSize: FontSize.md, color: Colors.textSecondary },

    // Place prediction row
    predRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      backgroundColor: Colors.surface, borderRadius: Radius.lg,
      borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, ...Shadow.xs,
    },
    predTile: {
      width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center', gap: 1,
    },
    predDist:      { fontSize: FontSize.xxs, color: Colors.textTertiary },
    predBody:      { flex: 1 },
    predPrimary:   { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    predSecondary: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1, lineHeight: 18 },
  });
