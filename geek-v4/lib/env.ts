// IMPORTANT: Expo は `process.env.EXPO_PUBLIC_XXX` という STATIC な参照しかインライン化しない。
// 動的キー (`process.env[key]`) を使うと undefined になるため、ベタ書き必須。

function warnIfMissing(key: string, value: string | undefined): string {
  if (!value && typeof console !== 'undefined') {
    console.warn(`[env] Missing ${key}`);
  }
  return value ?? '';
}

export const ENV = {
  SUPABASE_URL: warnIfMissing('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  SUPABASE_ANON_KEY: warnIfMissing('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '',
  POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
  SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  IS_DEV: __DEV__,
} as const;
