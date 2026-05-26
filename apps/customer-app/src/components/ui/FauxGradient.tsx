import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

interface Props {
  from:     string;
  to:       string;
  style?:   StyleProp<ViewStyle>;
  children?: React.ReactNode;
  steps?:   number;
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function mix([r1, g1, b1]: [number, number, number], [r2, g2, b2]: [number, number, number], t: number): string {
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

export default function FauxGradient({ from, to, style, children, steps = 8 }: Props) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);

  return (
    <View style={[styles.container, style]}>
      <View style={StyleSheet.absoluteFill}>
        {Array.from({ length: steps }).map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              backgroundColor: mix(a, b, i / (steps - 1)),
            }}
          />
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
});
