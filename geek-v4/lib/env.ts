function required(key: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

export const ENV = {
  SUPABASE_URL: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  SUPABASE_ANON_KEY: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '',
  POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
  SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  IS_DEV: __DEV__,
} as const;
