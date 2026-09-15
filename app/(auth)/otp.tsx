import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { OTP_LENGTH, OTP_RESEND_SECONDS, requestOtp } from '@/api/services';
import { Button, Screen, Text } from '@/components';
import { formatMobile, toLatinDigits, toPersianDigits } from '@/lib/format';
import { useCountdownSeconds } from '@/lib/useCountdownSeconds';
import { useAuthStore } from '@/store/auth';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

export default function OtpScreen() {
  const { t, tr, colors, language } = useTheme();
  const params = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const phone = params.phone ?? '';

  const signIn = useAuthStore((s) => s.signIn);
  const inputRef = useRef<TextInput>(null);

  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(params.devCode ?? '');
  const [resendKey, setResendKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const secondsLeft = useCountdownSeconds(OTP_RESEND_SECONDS, resendKey);

  const verify = useCallback(
    async (value: string) => {
      setLoading(true);
      setError(null);
      try {
        const { needsProfile } = await signIn(phone, value);
        router.replace(needsProfile ? '/(auth)/role' : '/(app)');
      } catch (err) {
        setCode('');
        if (err instanceof ApiError && err.code === 'otp_expired') setError(t.auth.otpExpired);
        else if (err instanceof ApiError && err.code === 'otp_invalid') setError(t.auth.otpInvalid);
        else setError(t.common.error);
      } finally {
        setLoading(false);
      }
    },
    [phone, signIn, t],
  );

  // Auto-submit as soon as the full code is entered, the way SMS autofill delivers it.
  useEffect(() => {
    if (code.length === OTP_LENGTH && !loading) void verify(code);
  }, [code, loading, verify]);

  const resend = async () => {
    setError(null);
    setCode('');
    const result = await requestOtp(phone);
    setDevCode(result.devCode ?? '');
    setResendKey((k) => k + 1);
  };

  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => code[i] ?? '');

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen contentStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="title" weight="bold">
            {t.auth.otpTitle}
          </Text>
          <Text variant="small" tone="muted">
            {t.auth.otpSubtitle}
          </Text>
          <View style={styles.phoneRow}>
            <Text variant="body" weight="bold">
              {formatMobile(phone, language)}
            </Text>
            <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
              <Text variant="small" tone="primary" weight="medium">
                {t.auth.changeNumber}
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={() => inputRef.current?.focus()} style={styles.boxes} accessibilityRole="button">
          {digits.map((digit, index) => (
            <View
              key={index}
              style={[
                styles.box,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: error ? colors.red : digit ? colors.primary : colors.border,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Text variant="heading" weight="bold" center>
                {digit ? (language === 'fa' ? toPersianDigits(digit) : digit) : ''}
              </Text>
            </View>
          ))}
        </Pressable>

        {/* Off-screen field that owns the real keyboard input for the boxes above. */}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(text) => {
            setCode(toLatinDigits(text).replace(/\D/g, '').slice(0, OTP_LENGTH));
            if (error) setError(null);
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          maxLength={OTP_LENGTH}
          style={styles.hiddenInput}
          caretHidden
        />

        {error ? (
          <Text variant="small" tone="red" center>
            {error}
          </Text>
        ) : null}

        {devCode ? (
          <Text variant="caption" tone="amber" center>
            {tr(t.auth.devCodeHint, { code: language === 'fa' ? toPersianDigits(devCode) : devCode })}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={t.auth.verify}
            onPress={() => void verify(code)}
            loading={loading}
            disabled={code.length !== OTP_LENGTH}
            size="lg"
          />
          {secondsLeft > 0 ? (
            <Text variant="small" tone="faint" center>
              {tr(t.auth.resendIn, {
                s: language === 'fa' ? toPersianDigits(secondsLeft) : secondsLeft,
              })}
            </Text>
          ) : (
            <Button label={t.auth.resend} onPress={() => void resend()} variant="ghost" size="sm" />
          )}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: spacing.xl, justifyContent: 'center', minHeight: '100%' },
  header: { gap: spacing.sm },
  phoneRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  boxes: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  box: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 3,
    height: 56,
    justifyContent: 'center',
    width: 46,
  },
  hiddenInput: { height: 1, opacity: 0, position: 'absolute', width: 1 },
  actions: { gap: spacing.md },
});
