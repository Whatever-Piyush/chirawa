import React, { useMemo, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Linking, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AddressResponse } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import type { RootStackParamList } from '../../navigation/AppNavigator';

// WhatsApp brand green — kept literal since it represents an external brand,
// not part of our palette.
const WHATSAPP_GREEN = '#25D366';

interface Props {
  visible:    boolean;
  onClose:    () => void;
  addresses:  AddressResponse[];
  userName:   string | null;
  userPhone:  string | null;
  onChanged:  () => void;   // re-fetch addresses after a default change
}

function labelEmoji(label?: string | null): string {
  if (label === 'घर')    return '🏠';
  if (label === 'दुकान') return '🏪';
  return '📍';
}

export default function LocationSheet({
  visible, onClose, addresses, userName, userPhone, onChanged,
}: Props) {
  const t      = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [query,  setQuery]  = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filter saved addresses by the typed text (street / locality / label).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return addresses;
    return addresses.filter((a) =>
      `${a.street} ${a.locality} ${a.city} ${a.label ?? ''}`.toLowerCase().includes(q),
    );
  }, [addresses, query]);

  const addNewAddress = () => { onClose(); navigation.navigate('AddressMap'); };
  // "Use current location" drops the user on the map already homing in on GPS.
  const useCurrentLocation = () => { onClose(); navigation.navigate('AddressMap', { autoLocate: true }); };

  const requestFromOther = () => {
    // Deep link that opens the recipient's Bringly app to the "share your address"
    // screen, carrying who's asking + the number to send the address back to.
    const qs = [
      userName  ? `from=${encodeURIComponent(userName)}`   : null,
      userPhone ? `phone=${encodeURIComponent(userPhone)}` : null,
    ].filter(Boolean).join('&');
    const link = `bringly://share-address${qs ? `?${qs}` : ''}`;
    const msg  = encodeURIComponent(`${t('locationSheet.requestMessage')}\n${link}`);
    void Linking.openURL(`https://wa.me/?text=${msg}`).catch(() => {});
  };

  const selectAddress = async (item: AddressResponse) => {
    if (item.isDefault) { onClose(); return; }
    setBusyId(item.id);
    try {
      await api.setDefaultAddress(item.id);
      onChanged();
      onClose();
    } catch {
      /* tolerate — keep sheet open so the user can retry */
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          {/* Title row */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('locationSheet.selectTitle')}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('locationSheet.searchPlaceholder')}
              placeholderTextColor={Colors.textMuted}
              returnKeyType="search"
            />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
          >
            {/* Quick actions */}
            <View style={styles.actionCard}>
              <ActionRow
                icon="locate"
                iconColor={Colors.primary}
                label={t('locationSheet.useCurrent')}
                onPress={useCurrentLocation}
                styles={styles}
                Colors={Colors}
              />
              <View style={styles.actionDivider} />
              <ActionRow
                icon="add"
                iconColor={Colors.primary}
                label={t('locationSheet.addNew')}
                onPress={addNewAddress}
                styles={styles}
                Colors={Colors}
              />
              <View style={styles.actionDivider} />
              <ActionRow
                icon="logo-whatsapp"
                iconColor={WHATSAPP_GREEN}
                label={t('locationSheet.requestOther')}
                onPress={requestFromOther}
                styles={styles}
                Colors={Colors}
              />
            </View>

            {/* Saved addresses */}
            <Text style={styles.savedHeading}>{t('locationSheet.savedTitle')}</Text>

            {filtered.length === 0 ? (
              <Text style={styles.noneText}>{t('locationSheet.noneSaved')}</Text>
            ) : (
              filtered.map((item) => {
                const busy = busyId === item.id;
                const fullAddress =
                  `${item.street}, ${item.locality}` +
                  `${item.city ? `, ${item.city}` : ''} — ${item.pincode}`;
                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.85}
                    onPress={() => void selectAddress(item)}
                    style={[styles.addrCard, item.isDefault && styles.addrCardActive]}
                  >
                    {/* Label tile + selected check */}
                    <View style={styles.addrLeft}>
                      <View style={styles.labelTile}>
                        <Text style={styles.labelEmoji}>{labelEmoji(item.label)}</Text>
                      </View>
                      {item.isDefault && (
                        <View style={styles.checkBadge}>
                          <Ionicons name="checkmark" size={12} color={Colors.white} />
                        </View>
                      )}
                    </View>

                    {/* Name + address + phone */}
                    <View style={styles.addrBody}>
                      <Text style={styles.addrName} numberOfLines={1}>
                        {userName ?? (item.label ?? t('locationSheet.deliverHere'))}
                      </Text>
                      <Text style={styles.addrText} numberOfLines={3}>{fullAddress}</Text>
                      {userPhone ? (
                        <Text style={styles.addrPhone}>
                          {t('locationSheet.phoneNumber')}: <Text style={styles.addrPhoneNum}>{userPhone}</Text>
                        </Text>
                      ) : null}
                    </View>

                    {/* Trailing state */}
                    <View style={styles.addrTrailing}>
                      {busy ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : item.isDefault ? (
                        <Ionicons name="radio-button-on" size={20} color={Colors.primary} />
                      ) : (
                        <Ionicons name="radio-button-off" size={20} color={Colors.textTertiary} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Single quick-action row ──────────────────────────────────────────────────

function ActionRow({
  icon, iconColor, label, onPress, styles, Colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  Colors: ColorPalette;
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    backdropTap: { flex: 1 },
    sheet: {
      backgroundColor:      Colors.background,
      borderTopLeftRadius:  Radius.xl,
      borderTopRightRadius: Radius.xl,
      paddingHorizontal:    Spacing.lg,
      paddingTop:           Spacing.lg,
      maxHeight:            '88%',
    },

    titleRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: Spacing.md,
    },
    title:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    closeBtn: {
      width: 32, height: 32, borderRadius: Radius.full,
      backgroundColor: Colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },

    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: Colors.surface,
      // Rectangular (small radius) — intentionally NOT a pill/oval.
      borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: Spacing.md, height: 50,
      ...Shadow.xs,
    },
    searchInput: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, padding: 0 },

    scroll: { paddingTop: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.lg },

    // Quick-action card
    actionCard: {
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
      ...Shadow.xs,
    },
    actionRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      paddingHorizontal: Spacing.lg, minHeight: 58,
    },
    actionIcon: {
      width: 38, height: 38, borderRadius: Radius.sm,
      alignItems: 'center', justifyContent: 'center',
    },
    actionLabel: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
    actionDivider: { height: 1, backgroundColor: Colors.divider, marginLeft: 58 },

    // Saved addresses
    savedHeading: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
    noneText:     { fontSize: FontSize.md, color: Colors.textTertiary, paddingVertical: Spacing.lg, textAlign: 'center' },

    addrCard: {
      flexDirection: 'row', gap: Spacing.md,
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
      padding: Spacing.lg, marginTop: Spacing.md,
      ...Shadow.xs,
    },
    addrCardActive: { borderColor: Colors.primary, borderWidth: 1.5 },
    addrLeft: { width: 48, alignItems: 'center' },
    labelTile: {
      width: 44, height: 44, borderRadius: Radius.md,
      backgroundColor: Colors.primaryLight,
      alignItems: 'center', justifyContent: 'center',
    },
    labelEmoji: { fontSize: 22 },
    checkBadge: {
      position: 'absolute', top: -4, left: -4,
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: Colors.success,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: Colors.surface,
    },
    addrBody: { flex: 1, gap: 2 },
    addrName: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    addrText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 19 },
    addrPhone:    { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
    addrPhoneNum: { fontWeight: FontWeight.bold, color: Colors.textPrimary },
    addrTrailing: { width: 24, alignItems: 'center', justifyContent: 'center' },
  });
