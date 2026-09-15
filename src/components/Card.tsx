import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  padded?: boolean;
  accentColor?: string;
}

/** Surface container; an `accentColor` draws the leading edge stripe. */
export function Card({ children, onPress, style, padded = true, accentColor }: CardProps) {
  const { colors, isRtl } = useTheme();

  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: radius.lg,
    padding: padded ? spacing.lg : 0,
    overflow: 'hidden',
  };

  const stripe = accentColor ? (
    <View
      style={[
        styles.stripe,
        {
          backgroundColor: accentColor,
          [isRtl ? 'right' : 'left']: 0,
        } as ViewStyle,
      ]}
    />
  ) : null;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [base, pressed && styles.pressed, style]}
        accessibilityRole="button"
      >
        {stripe}
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[base, style]}>
      {stripe}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  stripe: { position: 'absolute', top: 0, bottom: 0, width: 4 },
});
