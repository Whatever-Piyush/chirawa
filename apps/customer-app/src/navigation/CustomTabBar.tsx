import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useT } from '@chirawa/i18n';
import { Text } from '../components/ui';
import { Colors } from '../theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Route → presentation. The internal route name stays "OrderHistory" (so the
// notification deep-links and Profile→orders navigation keep working) while
// the visible label/icon are the redesigned "Order Again".
const LABEL_KEY: Record<string, string> = {
  Home:         'home.tabHome',
  OrderHistory: 'home.tabOrderAgain',
  Categories:   'home.tabCategories',
  Special:      'home.tabSpecial',
};

const ICON: Record<string, { on: IoniconName; off: IoniconName }> = {
  Home:         { on: 'home',    off: 'home-outline'    },
  OrderHistory: { on: 'refresh', off: 'refresh-outline' },
  Categories:   { on: 'grid',    off: 'grid-outline'    },
  Special:      { on: 'star',    off: 'star-outline'    },
};

// Routes that exist in the navigator but are NOT drawn in the bar. Profile is
// reached from the Home header avatar; keeping it as a (hidden) tab means all
// existing navigate('MainTabs', { screen: 'Profile' }) calls keep working.
const HIDDEN = new Set(['Profile']);

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const t = useT();

  return (
    <View
      style={[
        styles.bar,
        { height: 60 + insets.bottom, paddingBottom: insets.bottom },
      ]}
    >
      {state.routes.map((route, index) => {
        if (HIDDEN.has(route.name)) return null;

        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const label = t(LABEL_KEY[route.name] ?? 'home.tabHome');
        const icons = ICON[route.name] ?? ICON.Home;

        // ── Raised red "Special" pill ──────────────────────────────────────
        if (route.name === 'Special') {
          return (
            <View key={route.key} style={styles.slot}>
              <TouchableOpacity
                onPress={onPress}
                activeOpacity={0.85}
                style={styles.specialPill}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={label}
              >
                <Ionicons
                  name={isFocused ? icons.on : icons.off}
                  size={18}
                  color={Colors.white}
                />
                <Text weight="bold" color={Colors.white} style={styles.specialLabel}>
                  {label}
                </Text>
              </TouchableOpacity>
            </View>
          );
        }

        // ── Normal tab ──────────────────────────────────────────────────────
        const tint = isFocused ? Colors.primary : Colors.textSecondary;
        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            activeOpacity={0.7}
            style={styles.slot}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={label}
          >
            <Ionicons
              name={isFocused ? icons.on : icons.off}
              size={isFocused ? 26 : 24}
              color={tint}
            />
            <Text weight="medium" color={tint} style={styles.label}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection:   'row',
    backgroundColor: Colors.footerBg,
    borderTopWidth:  0.5,
    borderTopColor:  Colors.footerBorder,
    paddingTop:      6,
    // top shadow
    shadowColor:   '#000',
    shadowOpacity: 0.06,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: -2 },
    elevation:     8,
  },
  slot: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            2,
  },
  label: {
    fontSize:   10,
    lineHeight: 13,
  },
  specialPill: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             5,
    backgroundColor: Colors.specialAccent,
    borderRadius:    14,
    width:           90,
    height:          44,
    marginTop:       -8,   // lift above the bar baseline
    // red glow
    shadowColor:   '#C4383A',
    shadowOpacity: 0.35,
    shadowRadius:  6,
    shadowOffset:  { width: 0, height: 3 },
    elevation:     6,
  },
  specialLabel: {
    fontSize:   11,
    lineHeight: 14,
  },
});
