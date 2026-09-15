import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/**
 * Runs an async loader on mount and whenever `deps` change, dropping results
 * from a superseded call so a slow response cannot overwrite a newer one.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const runIdRef = useRef(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const runId = ++runIdRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    loaderRef
      .current()
      .then((result) => {
        if (cancelled || runId !== runIdRef.current) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled || runId !== runIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (cancelled || runId !== runIdRef.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}
