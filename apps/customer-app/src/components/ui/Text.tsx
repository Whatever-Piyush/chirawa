import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { Colors, FontSize, FontWeight } from '../../theme';

export type TextVariant =
  | 'hero'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodySmall'
  | 'caption'
  | 'label'
  | 'price';

type Weight = keyof typeof FontWeight;

interface Props extends Omit<RNTextProps, 'style'> {
  variant?:       TextVariant;
  color?:         string;
  weight?:        Weight;
  align?:         TextStyle['textAlign'];
  numberOfLines?: number;
  style?:         RNTextProps['style'];
  children?:      React.ReactNode;
}

const VARIANT_STYLES: Record<TextVariant, TextStyle> = {
  hero:      { fontSize: FontSize.hero, fontWeight: FontWeight.heavy,    lineHeight: 44 },
  h1:        { fontSize: FontSize.xxxl, fontWeight: FontWeight.black,    lineHeight: 36 },
  h2:        { fontSize: FontSize.xxl,  fontWeight: FontWeight.bold,     lineHeight: 30 },
  h3:        { fontSize: FontSize.xl,   fontWeight: FontWeight.bold,     lineHeight: 26 },
  body:      { fontSize: FontSize.md,   fontWeight: FontWeight.regular,  lineHeight: 22 },
  bodySmall: { fontSize: FontSize.sm,   fontWeight: FontWeight.regular,  lineHeight: 19 },
  caption:   { fontSize: FontSize.xs,   fontWeight: FontWeight.medium,   lineHeight: 16 },
  label:     { fontSize: FontSize.sm,   fontWeight: FontWeight.semibold, lineHeight: 18 },
  price:     { fontSize: FontSize.lg,   fontWeight: FontWeight.black,    lineHeight: 22 },
};

export default function Text({
  variant = 'body',
  color,
  weight,
  align,
  numberOfLines,
  style,
  children,
  ...rest
}: Props) {
  const base = VARIANT_STYLES[variant];
  const composed: TextStyle = {
    ...base,
    color: color ?? Colors.textPrimary,
    ...(weight ? { fontWeight: FontWeight[weight] } : null),
    ...(align  ? { textAlign:  align } : null),
  };

  return (
    <RNText
      {...rest}
      numberOfLines={numberOfLines}
      style={[composed, style]}
    >
      {children}
    </RNText>
  );
}
