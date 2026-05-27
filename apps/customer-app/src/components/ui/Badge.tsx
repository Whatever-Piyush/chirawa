import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '../../theme';
import Text from './Text';

export type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral';

interface Props {
  label:   string;
  variant?: BadgeVariant;
  style?:   StyleProp<ViewStyle>;
}

const PALETTE: Record<BadgeVariant, { bg: string; fg: string }> = {
  success: { bg: Colors.successLight, fg: Colors.success },
  error:   { bg: Colors.errorLight,   fg: Colors.error   },
  warning: { bg: Colors.warningLight, fg: Colors.warning },
  info:    { bg: Colors.infoLight,    fg: Colors.info    },
  neutral: { bg: Colors.surfaceAlt,   fg: Colors.textSecondary },
};

export default function Badge({ label, variant = 'neutral', style }: Props) {
  const { bg, fg } = PALETTE[variant];
  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      <Text
        variant="caption"
        color={fg}
        style={styles.text}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical:   Spacing.xxs,
    borderRadius:      Radius.full,
    alignSelf:         'flex-start',
  },
  text: {
    fontSize:   FontSize.xs,
    fontWeight: FontWeight.bold,
    lineHeight: 16,
  },
});
