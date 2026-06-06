import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { poppinsFamily, Shadow } from '../../theme';

// Original grocery-bag illustration for empty/hero states — a warm paper bag
// with the Bringly wordmark, two handles and groceries poking out of the top.
// Composed entirely from views + emoji, so it needs no image asset and re-tints
// with the active theme.
interface Props {
  size?: number;
}

export default function BringlyBag({ size = 150 }: Props) {
  const { colors: Colors } = useTheme();
  const s = useMemo(() => makeStyles(Colors, size), [Colors, size]);

  return (
    <View style={s.wrap}>
      {/* Soft circular backdrop */}
      <View style={s.backdrop} />

      {/* Groceries poking out of the bag's open top */}
      <Text style={[s.item, s.greens]}>🥬</Text>
      <Text style={[s.item, s.bread]}>🥖</Text>
      <Text style={[s.item, s.milk]}>🥛</Text>
      <Text style={[s.item, s.tomato]}>🍅</Text>
      <Text style={[s.item, s.juice]}>🧃</Text>

      {/* Paper-bag handles */}
      <View style={[s.handle, s.handleLeft]} />
      <View style={[s.handle, s.handleRight]} />

      {/* Bag body */}
      <View style={s.bag}>
        <View style={s.fold} />
        <View style={s.shine} />
        <View style={s.panel}>
          <Text style={s.word} numberOfLines={1}>Bringly</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette, size: number) =>
  StyleSheet.create({
    wrap: {
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    backdrop: {
      position: 'absolute',
      top: size * 0.04,
      left: size * 0.05,
      width: size * 0.90,
      height: size * 0.90,
      borderRadius: size * 0.45,
      backgroundColor: Colors.primaryLight,
    },

    item: { position: 'absolute', zIndex: 1 },
    greens: { top: size * 0.00, left:  size * 0.20, fontSize: size * 0.21 },
    bread:  { top: size * 0.06, left:  size * 0.42, fontSize: size * 0.18 },
    milk:   { top: size * 0.05, right: size * 0.22, fontSize: size * 0.17 },
    tomato: { top: size * 0.15, left:  size * 0.30, fontSize: size * 0.13 },
    juice:  { top: size * 0.14, right: size * 0.27, fontSize: size * 0.13 },

    handle: {
      position: 'absolute',
      top: size * 0.20,
      width: size * 0.17,
      height: size * 0.13,
      borderColor: Colors.primaryDark,
      borderWidth: size * 0.03,
      borderBottomWidth: 0,
      borderTopLeftRadius: 999,
      borderTopRightRadius: 999,
      backgroundColor: 'transparent',
      zIndex: 1,
    },
    handleLeft:  { left:  size * 0.28 },
    handleRight: { right: size * 0.28 },

    bag: {
      width: size * 0.76,
      height: size * 0.60,
      backgroundColor: Colors.primary,
      borderTopLeftRadius: size * 0.05,
      borderTopRightRadius: size * 0.05,
      borderBottomLeftRadius: size * 0.14,
      borderBottomRightRadius: size * 0.14,
      overflow: 'hidden',
      zIndex: 2,
      ...Shadow.md,
    },
    // Darker folded paper rim across the top of the bag.
    fold: {
      height: size * 0.14,
      backgroundColor: Colors.primaryDark,
    },
    // Subtle vertical highlight down the centre for a little depth.
    shine: {
      position: 'absolute',
      top: size * 0.14,
      left: size * 0.30,
      width: size * 0.10,
      bottom: 0,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    panel: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    word: {
      color: Colors.white,
      fontFamily: poppinsFamily('bold'),
      fontSize: size * 0.15,
      letterSpacing: -0.5,
    },
  });
