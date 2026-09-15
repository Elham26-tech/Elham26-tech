import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { currencyRates, countries, type CurrencyCode } from '@/api/fixtures';
import { listRfqs } from '@/api/services';
import { Badge, Button, Card, Chip, EmptyState, Screen, SectionHeader, Text, TextField } from '@/components';
import { formatDate, formatNumber, toLatinDigits } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { useSettingsStore } from '@/store/settings';
import { moduleColors, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

const CURRENCIES: CurrencyCode[] = ['IRT', 'USD', 'EUR', 'AED', 'CNY'];

export default function TradeScreen() {
  const { t, colors, isRtl, language } = useTheme();
  const { num } = useFormatters();
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const { data, loading, reload } = useAsync(() => listRfqs(), []);
  const [amount, setAmount] = useState('1000000');
  const [from, setFrom] = useState<CurrencyCode>('IRT');
  const [to, setTo] = useState<CurrencyCode>('USD');

  const parsed = Number(toLatinDigits(amount).replace(/[^\d.]/g, '')) || 0;
  // Rates are expressed per toman, so convert through toman as the pivot.
  const converted = (parsed / currencyRates[from]) * currencyRates[to];

  const statusColor = {
    sent: colors.amber,
    quoted: colors.green,
    closed: colors.textFaint,
  } as const;

  return (
    <Screen contentStyle={styles.content}>
      <Card accentColor={moduleColors.trade}>
        <Text variant="small" tone="muted">
          {t.trade.language}
        </Text>
        <View style={[styles.chipRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Chip label="فارسی" selected={language === 'fa'} onPress={() => setLanguage('fa')} />
          <Chip label="English" selected={language === 'en'} onPress={() => setLanguage('en')} />
        </View>

        <View style={[styles.flagRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          {countries.map((country) => (
            <Text key={country.code} variant="title">
              {country.flag}
            </Text>
          ))}
        </View>
      </Card>

      <Card>
        <Text variant="title" weight="bold" style={styles.sectionTitle}>
          {t.trade.currencyConverter}
        </Text>
        <TextField
          value={amount}
          onChangeText={(text) => setAmount(toLatinDigits(text).replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
        />
        <View style={[styles.chipRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          {CURRENCIES.map((code) => (
            <Chip key={`from-${code}`} label={code} selected={from === code} onPress={() => setFrom(code)} />
          ))}
        </View>
        <Text variant="caption" tone="faint" center style={styles.arrow}>
          ↓
        </Text>
        <View style={[styles.chipRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          {CURRENCIES.map((code) => (
            <Chip
              key={`to-${code}`}
              label={code}
              selected={to === code}
              color={colors.green}
              onPress={() => setTo(code)}
            />
          ))}
        </View>
        <Text variant="heading" weight="bold" tone="green" center style={styles.result}>
          {formatNumber(Math.round(converted * 100) / 100, language)} {to}
        </Text>
      </Card>

      <View style={styles.actionRow}>
        <Button label={t.trade.newRfq} onPress={() => router.push('/trade/rfq')} size="lg" />
        <Button
          label={`${t.trade.exportGuide} — ${t.trade.guideDesc}`}
          onPress={() => router.push('/trade/guide')}
          variant="secondary"
        />
      </View>

      <View>
        <SectionHeader title={t.trade.myRfqs} actionLabel={t.common.retry} onAction={reload} />
        {loading ? (
          <EmptyState title={t.common.loading} loading />
        ) : (data ?? []).length === 0 ? (
          <EmptyState title={t.common.empty} emoji="🌍" />
        ) : (
          <View style={styles.list}>
            {(data ?? []).map((rfq) => {
              const country = countries.find((c) => c.code === rfq.destinationCountry);
              return (
                <Card key={rfq.id} accentColor={statusColor[rfq.status]}>
                  <View style={[styles.rfqHead, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                    <Badge label={rfq.reference} color={statusColor[rfq.status]} />
                    <Text variant="caption" tone="faint">
                      {formatDate(rfq.createdAt, language)}
                    </Text>
                  </View>

                  <Text variant="body" weight="bold" numberOfLines={1} style={styles.rfqTitle}>
                    {rfq.productTitle}
                  </Text>

                  <View style={[styles.rfqMeta, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                    <Text variant="caption" tone="muted">
                      {num(rfq.quantity)} {rfq.unit === 'm2' ? 'm²' : rfq.unit} · {rfq.incoterm}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {country ? `${country.flag} ${language === 'fa' ? country.fa : country.en}` : rfq.destinationCountry}
                    </Text>
                    <Text variant="caption" tone="green" weight="medium">
                      {t.trade.quotes}: {num(rfq.quotes)}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  chipRow: { flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  flagRow: { flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  sectionTitle: { marginBottom: spacing.md },
  arrow: { marginVertical: spacing.sm },
  result: { marginTop: spacing.lg },
  actionRow: { gap: spacing.md },
  list: { gap: spacing.md },
  rfqHead: { alignItems: 'center', justifyContent: 'space-between' },
  rfqTitle: { marginTop: spacing.sm },
  rfqMeta: { flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
});
