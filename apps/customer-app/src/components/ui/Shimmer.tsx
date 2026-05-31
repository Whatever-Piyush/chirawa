import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Radius } from '../../theme';
import { useTheme } from '../../theme/ThemeContext';

interface Props {
  width?:        number | `${number}%`;
  height?:       number;
  borderRadius?: number;
  style?:        StyleProp<ViewStyle>;
}

export default function Shimmer({
  width  = '100%',
  height = 14,
  borderRadius = Radius.sm,
  style,
}: Props) {
  const { colors: Colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue:         1,
          duration:        900,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue:         0.5,
          duration:        900,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width,
          height,
          borderRadius,
          backgroundColor: Colors.shimmer,
          opacity,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
