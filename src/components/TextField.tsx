import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Rendered on the leading edge, e.g. a `+۹۸` prefix or a currency unit. */
  prefix?: React.ReactNode;
  containerStyle?: ViewStyle;
}

export function TextField({
  label,
  hint,
  error,
  prefix,
  containerStyle,
  style,
  ...rest
}: TextFieldProps) {
  const { colors, isRtl } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.red : focused ? colors.primary : colors.border;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text variant="small" tone="muted" weight="medium" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor,
            borderRadius: radius.md,
            flexDirection: isRtl ? 'row-reverse' : 'row',
          },
        ]}
      >
        {prefix ? <View style={styles.prefix}>{prefix}</View> : null}
        <TextInput
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          placeholderTextColor={colors.textFaint}
          style={[
            styles.input,
            {
              color: colors.text,
              textAlign: isRtl ? 'right' : 'left',
              writingDirection: isRtl ? 'rtl' : 'ltr',
            },
            style,
          ]}
        />
      </View>

      {error ? (
        <Text variant="caption" tone="red" style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="faint" style={styles.helper}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { marginBottom: 2 },
  field: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  prefix: { paddingHorizontal: spacing.xs },
  input: { flex: 1, fontSize: 16, paddingVertical: spacing.md },
  helper: { marginTop: 2 },
});
