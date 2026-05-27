import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Radius } from '../../theme';

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
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue:         1,
          duration:        900,
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue:         0,
          duration:        900,
          useNativeDriver: false,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [progress]);

  const backgroundColor = progress.interpolate({
    inputRange:  [0, 1],
    outputRange: [Colors.shimmer, Colors.shimmerHigh],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        { width, height, borderRadius, backgroundColor },
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
