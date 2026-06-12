import React from 'react';
import { View, StyleSheet, type TextStyle } from 'react-native';
import { Text } from '../../components/ui';

// A decorative star overlay: absolutely-positioned little stars. Purely
// cosmetic — never intercepts touches — so it can sit behind any content. Each
// entry in `stars` carries its own position, fontSize, opacity, and optional
// color (defaults to white).
export default function Starfield({ stars }: { stars: TextStyle[] }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {stars.map((s, i) => (
        <Text key={i} style={[styles.star, s]}>{i % 4 === 0 ? '✧' : '✦'}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  star: { position: 'absolute', color: '#FFFFFF' },
});
