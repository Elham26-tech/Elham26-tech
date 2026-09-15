import { useCallback } from 'react';

import { currencyRates } from '@/api/fixtures';
import { formatNumber, formatPrice, toPersianDigits } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

/** 1 USD expressed in toman, derived from the shared rate table. */
export const USD_IN_TOMAN = 1 / currencyRates.USD;

/**
 * Price and number formatters bound to the active language, so a screen never
 * has to thread `language` through by hand.
 */
export function useFormatters() {
  const { language, t } = useTheme();

  const price = useCallback(
    (valueInToman: number) => formatPrice(valueInToman, language, USD_IN_TOMAN, t.common.currency),
    [language, t.common.currency],
  );

  const num = useCallback((value: number) => formatNumber(value, language), [language]);

  const percent = useCallback(
    (ratio: number) => `${formatNumber(Math.round(ratio * 100), language)}٪`.replace('٪', language === 'fa' ? '٪' : '%'),
    [language],
  );

  /** One-decimal rating, localised: `4.6` in English, `۴٫۶` in Persian. */
  const rating = useCallback(
    (value: number) => {
      const text = value.toFixed(1);
      return language === 'fa' ? toPersianDigits(text).replace('.', '٫') : text;
    },
    [language],
  );

  return { price, num, percent, rating };
}
