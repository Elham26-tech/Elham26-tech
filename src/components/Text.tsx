import React from 'react';
import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { fontSize } from '@/theme';

type Variant = 'caption' | 'small' | 'body' | 'title' | 'heading' | 'display';
type Tone = 'default' | 'muted' | 'faint' | 'primary' | 'amber' | 'green' | 'red' | 'inverse';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: 'regular' | 'medium' | 'bold';
  center?: boolean;
}

/**
 * Typography primitive. Every label goes through here so writing direction and
 * tone stay consistent between the Persian (RTL) and English (LTR) layouts.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  weight = 'regular',
  center,
  style,
  ...rest
}: TextProps) {
  const { colors, isRtl } = useTheme();

  const toneColor: Record<Tone, string> = {
    default: colors.text,
    muted: colors.textMuted,
    faint: colors.textFaint,
    primary: colors.primary,
    amber: colors.amber,
    green: colors.green,
    red: colors.red,
    inverse: colors.white,
  };

  return (
    <RNText
      {...rest}
      style={[
        {
          color: toneColor[tone],
          fontSize: fontSize[variant],
          fontWeight: weight === 'bold' ? '700' : weight === 'medium' ? '600' : '400',
          writingDirection: isRtl ? 'rtl' : 'ltr',
          textAlign: center ? 'center' : isRtl ? 'right' : 'left',
        },
        variant === 'display' || variant === 'heading' ? styles.tight : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  tight: { lineHeight: undefined },
});
