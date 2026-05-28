import React from 'react';
import { View, TouchableOpacity, type ViewStyle } from 'react-native';
import Text from './Text';
import { Colors, Spacing } from '../../theme';

interface Props {
  title:     string;
  subtitle?: string;
  onSeeAll?: () => void;
  seeAllColor?: string;     // override for sections like Chirawa's Special
  headerStyle?: ViewStyle;  // e.g. tinted background strip for §8
  children:  React.ReactNode;
}

// Shared section wrapper used by Bestsellers / Grocery / Snacks / Chirawa's Special.
// One source of truth so all section headers line up visually.
export default function SectionContainer({
  title,
  subtitle,
  onSeeAll,
  seeAllColor,
  headerStyle,
  children,
}: Props) {
  return (
    <View style={{ marginTop: Spacing.xxl }}>
      <View
        style={[
          {
            paddingHorizontal: Spacing.lg,
            marginBottom: Spacing.md,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: subtitle ? 'flex-start' : 'center',
          },
          headerStyle,
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text
            weight="bold"
            color={seeAllColor ?? Colors.textPrimary}
            style={{ fontSize: 18, lineHeight: 24 }}
          >
            {title}
          </Text>
          {subtitle && (
            <Text
              weight="regular"
              color={Colors.textSecondary}
              style={{ fontSize: 12, lineHeight: 16, marginTop: 2 }}
            >
              {subtitle}
            </Text>
          )}
        </View>
        {onSeeAll && (
          <TouchableOpacity
            onPress={onSeeAll}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              weight="medium"
              color={seeAllColor ?? Colors.primary}
              style={{ fontSize: 13 }}
            >
              See all  →
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}
