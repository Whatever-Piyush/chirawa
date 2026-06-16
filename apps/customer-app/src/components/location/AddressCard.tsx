import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AddressResponse } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { Text } from '../ui';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';

// Category avatar + display name from the saved label (घर/दुकान/होटल/अन्य).
export function labelMeta(
  label: string | null | undefined,
  t: (k: string) => string,
): { icon: React.ComponentProps<typeof Ionicons>['name']; name: string } {
  switch (label) {
    case 'घर':    return { icon: 'home',        name: t('address.typeHome') };
    case 'दुकान': return { icon: 'briefcase',   name: t('address.typeWork') };
    case 'होटल':  return { icon: 'bed',         name: t('address.typeHotel') };
    default:      return { icon: 'people',      name: t('address.typeOther') };
  }
}

interface Props {
  address:      AddressResponse;
  userName?:    string | null;
  userPhone?:   string | null;
  selected?:    boolean;
  onSelect?:    () => void;
  onSetDefault?: () => void;
  onShare?:     () => void;
  onMore?:      () => void;
}

// Reusable saved-address card — shared by the location sheet and My Addresses,
// so the two stay pixel-identical (IMG_3525 / IMG #12). Category avatar, name,
// 2-line address, phone, a pin (= set default), and ⋯ / share actions.
export default function AddressCard({
  address, userName, userPhone, selected, onSelect, onSetDefault, onShare, onMore,
}: Props) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const meta = labelMeta(address.label, t);
  const title = address.receiverName?.trim() || meta.name;
  const phone = address.receiverPhone?.trim() || userPhone;
  const fullAddress =
    `${address.street}, ${address.locality}` +
    `${address.city ? `, ${address.city}` : ''}` +
    `${address.pincode ? ` — ${address.pincode}` : ''}`;

  const Card = onSelect ? TouchableOpacity : View;

  return (
    <Card
      {...(onSelect ? { activeOpacity: 0.85, onPress: onSelect } : {})}
      style={[styles.card, selected && styles.cardSelected]}
    >
      {/* Pin (set default) — top-right */}
      {onSetDefault && (
        <TouchableOpacity
          style={styles.pinBtn}
          onPress={onSetDefault}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={address.isDefault ? 'Default address' : 'Set as default'}
        >
          <Ionicons
            name={address.isDefault ? 'bookmark' : 'bookmark-outline'}
            size={18}
            color={address.isDefault ? Colors.primary : Colors.textTertiary}
          />
        </TouchableOpacity>
      )}

      <View style={styles.row}>
        {/* Category avatar */}
        <View style={[styles.avatar, selected && styles.avatarSelected]}>
          <Ionicons name={meta.icon} size={24} color={Colors.primary} />
        </View>

        {/* Body */}
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text weight="bold" color={Colors.textPrimary} style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {address.isDefault && (
              <View style={styles.defaultPill}>
                <Text weight="semibold" color={Colors.primary} style={styles.defaultPillText}>
                  {t('address.defaultBadge')}
                </Text>
              </View>
            )}
          </View>

          <Text color={Colors.textSecondary} style={styles.addr} numberOfLines={3}>
            {fullAddress}
          </Text>

          {phone ? (
            <Text color={Colors.textSecondary} style={styles.phone}>
              {t('locationSheet.phoneNumber')}: <Text weight="bold" color={Colors.textPrimary}>{phone}</Text>
            </Text>
          ) : null}

          {/* Action buttons */}
          {(onMore || onShare) && (
            <View style={styles.actions}>
              {onMore && (
                <TouchableOpacity style={styles.actionBtn} onPress={onMore} accessibilityLabel="More options">
                  <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
              {onShare && (
                <TouchableOpacity style={styles.actionBtn} onPress={onShare} accessibilityLabel="Share address">
                  <Ionicons name="share-outline" size={18} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    card: {
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
      padding: Spacing.lg,
      ...Shadow.xs,
    },
    cardSelected: { borderColor: Colors.primary, borderWidth: 1.5 },

    pinBtn: { position: 'absolute', top: Spacing.md, right: Spacing.md, zIndex: 2, padding: 2 },

    row: { flexDirection: 'row', gap: Spacing.md },
    avatar: {
      width: 52, height: 52, borderRadius: Radius.md,
      backgroundColor: Colors.primaryLight,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarSelected: { backgroundColor: Colors.primaryLight },

    body: { flex: 1, paddingRight: 24 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    title: { fontSize: FontSize.lg },
    defaultPill: {
      backgroundColor: Colors.primaryLight, borderRadius: Radius.full,
      paddingHorizontal: Spacing.sm, paddingVertical: 1,
    },
    defaultPillText: { fontSize: FontSize.xxs },

    addr:  { fontSize: FontSize.sm, lineHeight: 19, marginTop: 2 },
    phone: { fontSize: FontSize.sm, marginTop: 4 },

    actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
    actionBtn: {
      width: 38, height: 38, borderRadius: Radius.full,
      backgroundColor: Colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
  });
