import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Spacing } from '../../theme';
import Text from './Text';

interface Props {
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export default function Divider({ label, style }: Props) {
  if (!label) {
    return <View style={[styles.line, style]} />;
  }
  return (
    <View style={[styles.row, style]}>
      <View style={styles.line} />
      <Text variant="caption" color={Colors.textTertiary} style={styles.label}>
        {label}
      </Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flex:            1,
    height:          StyleSheet.hairlineWidth,
    backgroundColor: Colors.divider,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  label: {
    marginHorizontal: Spacing.md,
    textTransform:    'uppercase',
    letterSpacing:    0.6,
  },
});
