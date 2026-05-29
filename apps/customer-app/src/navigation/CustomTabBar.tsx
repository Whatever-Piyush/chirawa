import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useT } from '@chirawa/i18n';
import { Text } from '../components/ui';
import { Colors } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabDef {
  routeName:       string;
  labelKey:        string;
  iconActive:      IconName;
  iconInactive:    IconName;
  pillColor:       string;
  activeIconColor: string;
}

// Premium pill-indicator nav with clean Ionicons (iOS-style, crisp). Internal
// route names are unchanged (so deep links / Profile nav keep working); only
// presentation is redesigned.
const TABS: ReadonlyArray<TabDef> = [
  { routeName: 'Home',         labelKey: 'home.tabHome',       iconActive: 'home',         iconInactive: 'home-outline',        pillColor: '#FFF0E9', activeIconColor: Colors.primary },
  { routeName: 'OrderHistory', labelKey: 'home.tabOrderAgain', iconActive: 'bag-handle',   iconInactive: 'bag-handle-outline',  pillColor: '#E8F5E9', activeIconColor: '#2E7D32' },
  { routeName: 'Categories',   labelKey: 'home.tabCategories', iconActive: 'grid',         iconInactive: 'grid-outline',        pillColor: '#EDE7F6', activeIconColor: '#5E35B1' },
];

const INACTIVE = '#9CA3AF';
// NOTE: the navigator also has a "Profile" route — it's deliberately never
// rendered here (reached from the Home header avatar). We render only the
// explicit TABS list + the Special button, so Profile simply isn't drawn.

// ── Regular tab (Home / Order Again / Categories) ────────────────────────────
function RegularTab({
  def, focused, onPress,
}: { def: TabDef; focused: boolean; onPress: () => void }) {
  const t = useT();
  const pill  = useRef(new Animated.Value(focused ? 1 : 0)).current;  // pill reveal
  const scale = useRef(new Animated.Value(1)).current;                // press bounce

  useEffect(() => {
    Animated.spring(pill, {
      toValue: focused ? 1 : 0,
      tension: 300, friction: 20,
      useNativeDriver: true,
    }).start();
  }, [focused, pill]);

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  const tint = focused ? def.activeIconColor : INACTIVE;
  // Active icon lifts gently into the blob for a premium, tactile feel.
  const lift = pill.interpolate({ inputRange: [0, 1], outputRange: [1, -3] });

  return (
    <TouchableOpacity
      style={styles.tab}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={t(def.labelKey)}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <View style={styles.iconBox}>
          {/* Soft colored pill/blob behind the icon — reveals on activate. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pill,
              {
                backgroundColor: def.pillColor,
                opacity: pill,
                transform: [{ scaleX: pill.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }],
              },
            ]}
          />
          <Animated.View style={{ transform: [{ translateY: lift }] }}>
            <Ionicons
              name={focused ? def.iconActive : def.iconInactive}
              size={23}
              color={tint}
            />
          </Animated.View>
        </View>
      </Animated.View>
      <Text weight={focused ? 'bold' : 'medium'} color={tint} style={styles.label}>
        {t(def.labelKey)}
      </Text>
    </TouchableOpacity>
  );
}

// ── Raised maroon "Special" button ───────────────────────────────────────────
function SpecialTab({ focused, onPress }: { focused: boolean; onPress: () => void }) {
  const t = useT();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <View style={styles.tab}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <TouchableOpacity
          onPress={handlePress}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityState={focused ? { selected: true } : {}}
          accessibilityLabel={t('home.tabSpecial')}
          style={[
            styles.special,
            focused && styles.specialActive,
          ]}
        >
          <Ionicons
            name={focused ? 'sparkles' : 'sparkles-outline'}
            size={19}
            color={Colors.white}
          />
          <Text weight="bold" color={Colors.white} style={styles.specialLabel}>
            {t('home.tabSpecial')}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const navigateTo = (routeName: string, key: string, isFocused: boolean) => () => {
    const event = navigation.emit({ type: 'tabPress', target: key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) navigation.navigate(routeName);
  };

  // Index lookup so focus state survives the route-name → presentation mapping.
  const indexOf = (name: string) => state.routes.findIndex((r) => r.name === name);
  const specialRoute = state.routes.find((r) => r.name === 'Special');

  return (
    <View style={[styles.bar, { height: 64 + insets.bottom, paddingBottom: insets.bottom }]}>
      {TABS.map((def) => {
        const idx = indexOf(def.routeName);
        if (idx < 0) return null;
        const route = state.routes[idx];
        const focused = state.index === idx;
        return (
          <RegularTab
            key={route.key}
            def={def}
            focused={focused}
            onPress={navigateTo(def.routeName, route.key, focused)}
          />
        );
      })}

      {specialRoute && (
        <SpecialTab
          focused={state.index === indexOf('Special')}
          onPress={navigateTo('Special', specialRoute.key, state.index === indexOf('Special'))}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection:   'row',
    backgroundColor: Colors.footerBg,
    borderTopWidth:  0.5,
    borderTopColor:  Colors.footerBorder,
    paddingTop:      8,
    shadowColor:   '#000',
    shadowOpacity: 0.08,
    shadowRadius:  12,
    shadowOffset:  { width: 0, height: -2 },
    elevation:     12,
  },
  tab: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            2,
  },
  iconBox: {
    width:          52,
    height:         32,
    alignItems:     'center',
    justifyContent: 'center',
  },
  pill: {
    position:     'absolute',
    width:        52,
    height:       32,
    borderRadius: 16,
  },
  label: {
    fontSize:   10,
    lineHeight: 13,
  },
  special: {
    width:           86,
    height:          46,
    borderRadius:    14,
    backgroundColor: Colors.specialAccent,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       -10,
    gap:             1,
    shadowColor:   '#C4383A',
    shadowOpacity: 0.4,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: -2 },
    elevation:     8,
  },
  specialActive: {
    backgroundColor: '#D4424A',
    borderWidth:     2,
    borderColor:     'rgba(255,255,255,0.4)',
  },
  specialLabel: {
    fontSize:   10,
    lineHeight: 12,
  },
});
