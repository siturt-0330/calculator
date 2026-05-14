import { Platform } from 'react-native';
import { ENV } from './env';

let posthog: { capture: (event: string, props?: Record<string, unknown>) => void } | null = null;

export function initAnalytics() {
  if (!ENV.POSTHOG_KEY) return;
  try {
    // PostHog は動的 import で初期化（バンドルサイズ対策）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostHog } = require('posthog-react-native');
    posthog = new PostHog(ENV.POSTHOG_KEY, { host: ENV.POSTHOG_HOST });
  } catch {
    // PostHog 未設定でもクラッシュさせない
  }
}

export function track(event: string, props?: Record<string, unknown>) {
  if (!posthog) return;
  try {
    posthog.capture(event, { platform: Platform.OS, ...props });
  } catch { /* ignore */ }
}
