import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { AddressResponse } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { Text } from '../ui';
import { FontSize, FontWeight, Radius, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';

interface Props {
  visible:       boolean;
  address:       AddressResponse | null;
  onClose:       () => void;
  onEdit:        (a: AddressResponse) => void;
  onShare:       (a: AddressResponse) => void;
  onSetDefault:  (a: AddressResponse) => void;
  onDelete:      (a: AddressResponse) => void;
}

// Bottom action menu for a saved address: Edit · Share · Set default · Delete.
export default function AddressActionsSheet({
  visible, address, onClose, onEdit, onShare, onSetDefault, onDelete,
}: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const run = (fn: (a: AddressResponse) => void) => () => {
    if (address) fn(address);
    onClose();
  };

  const rows: Array<{
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string; onPress: () => void; danger?: boolean; hide?: boolean;
  }> = [
    { icon: 'create-outline',   label: t('address.edit'),       onPress: run(onEdit) },
    { icon: 'share-outline',    label: t('address.share'),      onPress: run(onShare) },
    { icon: 'bookmark-outline', label: t('address.setDefault'), onPress: run(onSetDefault), hide: address?.isDefault },
    { icon: 'trash-outline',    label: t('address.delete'),     onPress: run(onDelete), danger: true },
  ];

  // NOT a React Native <Modal>: this is often rendered *inside* another modal
  // (the LocationSheet), and Android refuses to render nested modals. An
  // absolute-fill overlay works in every context.
  if (!visible || !address) return null;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.handle} />
        {rows.filter((r) => !r.hide).map((r) => (
          <TouchableOpacity key={r.label} style={styles.row} onPress={r.onPress} activeOpacity={0.7}>
            <Ionicons name={r.icon} size={22} color={r.danger ? Colors.error : Colors.textPrimary} />
            <Text
              weight="semibold"
              color={r.danger ? Colors.error : Colors.textPrimary}
              style={styles.rowLabel}
            >
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
      zIndex: 1000, elevation: 1000,
    },
    backdropTap: { ...StyleSheet.absoluteFillObject },
    sheet: {
      backgroundColor: Colors.surface,
      borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
      paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
    },
    handle: {
      alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
      backgroundColor: Colors.border, marginBottom: Spacing.sm,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      paddingVertical: Spacing.lg,
    },
    rowLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  });
