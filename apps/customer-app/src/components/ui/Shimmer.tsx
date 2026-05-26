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
      Animated.timing(progress, {
        toValue:         1,
        duration:        1100,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange:  [0, 1],
    outputRange: [-180, 180],
  });

  return (
    <View
      style={[
        styles.container,
        { width, height, borderRadius, backgroundColor: Colors.shimmer1 },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.sweep,
          {
            transform: [{ translateX }],
            backgroundColor: Colors.shimmer2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  sweep: {
    position: 'absolute',
    top:    0,
    bottom: 0,
    width:  90,
    opacity: 0.55,
  },
});
