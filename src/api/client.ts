import Constants from 'expo-constants';

/**
 * Thin HTTP client for the real backend.
 *
 * The app ships with a mock backend (`src/api/services.ts`) so every screen is
 * usable before the server exists. Point `EXPO_PUBLIC_API_BASE_URL` (or the
 * `extra.apiBaseUrl` value in app.json) at the real API and flip
 * `USE_MOCK_BACKEND` to false to switch over — request and response shapes are
 * already the ones in `src/api/types.ts`.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://api.sangbazar.example/v1';

export const USE_MOCK_BACKEND =
  (process.env.EXPO_PUBLIC_USE_MOCK_BACKEND ?? 'true') !== 'false';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeoutMs?: number;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, timeoutMs = 15_000, headers, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const errorPayload = payload as { message?: string; code?: string } | null;
      throw new ApiError(
        errorPayload?.message ?? `Request failed with status ${response.status}`,
        response.status,
        errorPayload?.code,
      );
    }

    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}
