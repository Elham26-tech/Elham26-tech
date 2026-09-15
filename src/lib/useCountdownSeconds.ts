import { useEffect, useState } from 'react';

/** Counts `seconds` down to zero once per second; reset by changing `key`. */
export function useCountdownSeconds(seconds: number, key: unknown): number {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(id);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, key]);

  return remaining;
}
