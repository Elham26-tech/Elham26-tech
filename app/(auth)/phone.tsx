import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { requestOtp } from '@/api/services';
import { BrandMark, Button, Screen, Text, TextField } from '@/components';
import { normalizeIranMobile, toPersianDigits } from '@/lib/format';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';


export default function PhoneScreen() {
  const { t, colors, language } = useTheme();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    const national = normalizeIranMobile(value);
    if (!national) {
      setError(t.auth.phoneInvalid);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await requestOtp(national);
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: national, devCode: result.devCode ?? '' },
      });
    } catch {
      setError(t.common.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen contentStyle={styles.content}>
        <View style={styles.header}>
          <BrandMark />
          <Text variant="heading" weight="bold" center>
            {t.common.appName}
          </Text>
          <Text variant="small" tone="muted" center>
            {t.common.tagline}
          </Text>
        </View>

        <View style={styles.form}>
          <Text variant="title" weight="bold">
            {t.auth.phoneTitle}
          </Text>
          <Text variant="small" tone="muted">
            {t.auth.phoneSubtitle}
          </Text>

          <TextField
            label={t.auth.phoneLabel}
            placeholder={t.auth.phonePlaceholder}
            value={value}
            onChangeText={(text) => {
              setValue(text);
              if (error) setError(null);
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={16}
            error={error}
            prefix={
              <Text variant="body" tone="muted" weight="medium">
                {language === 'fa' ? toPersianDigits('98+') : '+98'}
              </Text>
            }
            containerStyle={styles.field}
          />

          <Button
            label={t.auth.sendCode}
            onPress={onSubmit}
            loading={loading}
            disabled={value.trim().length === 0}
            size="lg"
          />

          <Text variant="caption" tone="faint" center style={{ color: colors.textFaint }}>
            {t.auth.terms}
          </Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: spacing.xxl, justifyContent: 'center', minHeight: '100%' },
  header: { alignItems: 'center', gap: spacing.sm },
  form: { gap: spacing.md },
  field: { marginTop: spacing.sm },
});
