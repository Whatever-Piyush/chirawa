import React, { useMemo } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';

interface Props {
  visible:          boolean;
  onEnable:         () => void;   // request permission (→ settings if blocked)
  onSelectManually: () => void;   // open the location sheet
}

// Shown on app open when location permission is off. Themed in Bringly orange.
export default function LocationPermissionModal({ visible, onEnable, onSelectManually }: Props) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSelectManually}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <MaterialCommunityIcons name="map-marker-off-outline" size={64} color={Colors.primary} style={styles.icon} />
          <Text style={styles.title}>{t('address.locPermTitle')}</Text>
          <Text style={styles.body}>{t('address.locPermBody')}</Text>

          <View style={styles.divider} />
          <TouchableOpacity style={styles.action} onPress={onEnable} activeOpacity={0.7}>
            <Text style={styles.actionPrimary}>{t('address.enableLocation')}</Text>
          </TouchableOpacity>

          <View style={styles.divider} />
          <TouchableOpacity style={styles.action} onPress={onSelectManually} activeOpacity={0.7}>
            <Text style={styles.actionSecondary}>{t('address.selectManually')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl,
    },
    card: {
      width: '100%', maxWidth: 360,
      backgroundColor: Colors.surface, borderRadius: Radius.xl,
      paddingTop: Spacing.xxl, alignItems: 'center',
      ...Shadow.lg,
    },
    icon:  { marginBottom: Spacing.md },
    title: {
      fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary,
      textAlign: 'center', paddingHorizontal: Spacing.xl,
    },
    body: {
      fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center',
      paddingHorizontal: Spacing.xl, marginTop: Spacing.sm, marginBottom: Spacing.lg,
      lineHeight: 21,
    },
    divider: { height: 1, alignSelf: 'stretch', backgroundColor: Colors.divider },
    action:  { alignSelf: 'stretch', paddingVertical: Spacing.lg, alignItems: 'center' },
    actionPrimary:   { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.primary },
    actionSecondary: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.primary },
  });
