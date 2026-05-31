import React, { useMemo, useState } from 'react';
import {
  ScrollView, TouchableOpacity, StyleSheet, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text } from '../../components/ui';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';

// Single source of truth for the 5 home chips — order matches spec §3.
// `id` is intentionally English-stable so persisted "active tab" state
// survives a locale switch.
type ChipId = 'all' | 'beauty' | 'grocery' | 'snacks' | 'dairy';

interface Chip {
  id:    ChipId;
  i18n:  string;
  icon:  React.ComponentProps<typeof Ionicons>['name'];
}

const CHIPS: ReadonlyArray<Chip> = [
  { id: 'all',     i18n: 'home.catAll',     icon: 'grid-outline'      },
  { id: 'beauty',  i18n: 'home.catBeauty',  icon: 'sparkles-outline'  },
  { id: 'grocery', i18n: 'home.catGrocery', icon: 'leaf-outline'      },
  { id: 'snacks',  i18n: 'home.catSnacks',  icon: 'fast-food-outline' },
  { id: 'dairy',   i18n: 'home.catDairy',   icon: 'water-outline'     },
];

interface Props {
  /** Optional callback when a chip is tapped — parent can scroll to section,
   *  filter shop list, etc. For Chunk 3 we just manage active state locally
   *  so the UI is responsive even with no listener wired up. */
  onSelect?: (id: ChipId) => void;
  /** Optional controlled active id. */
  active?: ChipId;
}

export default function CategoryTabs({ onSelect, active }: Props) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [internal, setInternal] = useState<ChipId>('all');
  const activeId = active ?? internal;

  function handleTap(id: ChipId) {
    if (active === undefined) setInternal(id);
    onSelect?.(id);
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {CHIPS.map((chip) => {
        const isActive = chip.id === activeId;
        return (
          <TouchableOpacity
            key={chip.id}
            style={[styles.chip, isActive ? styles.chipActive : styles.chipInactive]}
            onPress={() => handleTap(chip.id)}
            activeOpacity={0.85}
          >
            <Ionicons
              name={chip.icon}
              size={15}
              color={isActive ? Colors.white : Colors.textSecondary}
              style={styles.chipIcon}
            />
            <Text
              weight="medium"
              color={isActive ? Colors.white : Colors.textSecondary}
              style={styles.chipLabel}
            >
              {t(chip.i18n)}
            </Text>
          </TouchableOpacity>
        );
      })}
      {/* Trailing spacer so the last chip can scroll past the screen edge. */}
      <View style={{ width: 6 }} />
    </ScrollView>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  row: {
    paddingHorizontal: 14,   // spec §3
    paddingVertical:    8,
    gap:               10,
    alignItems:        'center',
  },
  chip: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: 16,
    paddingVertical:   7,
    borderRadius:      20,   // pill
    borderWidth:       1,
  },
  chipInactive: {
    backgroundColor: Colors.surface,
    borderColor:     Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor:     Colors.primary,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipLabel: {
    fontSize: 13,
  },
});
