import * as Sentry from '@sentry/react-native';
import { ENV } from './env';

export function initSentry() {
  if (!ENV.SENTRY_DSN) return;
  Sentry.init({
    dsn: ENV.SENTRY_DSN,
    environment: ENV.IS_DEV ? 'development' : 'production',
    tracesSampleRate: 0.2,
  });
}

export { Sentry };
