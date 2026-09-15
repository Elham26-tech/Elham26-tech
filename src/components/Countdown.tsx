import React, { useEffect, useState } from 'react';

import { formatCountdown } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Text, type TextProps } from './Text';

interface CountdownProps extends Omit<TextProps, 'children'> {
  /** ISO timestamp the countdown runs down to. */
  target: string;
  onFinish?: () => void;
}

/** Ticks once a second and stops at zero; used for live auction lots. */
export function Countdown({ target, onFinish, ...textProps }: CountdownProps) {
  const { language } = useTheme();
  const [remaining, setRemaining] = useState(() => new Date(target).getTime() - Date.now());

  useEffect(() => {
    setRemaining(new Date(target).getTime() - Date.now());
    const id = setInterval(() => {
      const next = new Date(target).getTime() - Date.now();
      setRemaining(next);
      if (next <= 0) {
        clearInterval(id);
        onFinish?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [target, onFinish]);

  return <Text {...textProps}>{formatCountdown(remaining, language)}</Text>;
}
