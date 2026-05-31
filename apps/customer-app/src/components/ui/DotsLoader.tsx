import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

interface Props {
  color?: string;
  size?:  number;
  style?: StyleProp<ViewStyle>;
}

export default function DotsLoader({
  color = '#FFFFFF',
  size  = 6,
  style,
}: Props) {
  const dot0 = useRef(new Animated.Value(1)).current;
  const dot1 = useRef(new Animated.Value(1)).current;
  const dot2 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const cycle = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 0.2, duration: 350, delay, useNativeDriver: true }),
          Animated.timing(val, { toValue: 1,   duration: 350, useNativeDriver: true }),
        ]),
      );

    const anims = [cycle(dot0, 0), cycle(dot1, 150), cycle(dot2, 300)];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dot0, dot1, dot2]);

  const dotStyle = {
    width:           size,
    height:          size,
    borderRadius:    size / 2,
    backgroundColor: color,
  };

  return (
    <View style={[styles.row, style]}>
      <Animated.View style={[dotStyle, { opacity: dot0 }]} />
      <Animated.View style={[dotStyle, { opacity: dot1, marginLeft: size }]} />
      <Animated.View style={[dotStyle, { opacity: dot2, marginLeft: size }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'center',
  },
});
