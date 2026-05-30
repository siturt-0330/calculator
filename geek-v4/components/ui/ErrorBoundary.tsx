import React from 'react';
import { View, Text, Platform } from 'react-native';
import { PressableScale } from './PressableScale';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';

type State = { hasError: boolean; error: Error | null };

type Props = {
  children: React.ReactNode;
  // ルート/コンポーネント名 (Sentry breadcrumb 識別用)
  scope?: string;
  // フォールバック UI を自前で出したい場合
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Sentry に breadcrumb / event を送る (lazy)
    try {
      if (typeof window !== 'undefined') {
        const Sentry = (globalThis as { Sentry?: { captureException?: (e: unknown, ctx?: unknown) => void; addBreadcrumb?: (b: unknown) => void } }).Sentry;
        if (Sentry?.addBreadcrumb) {
          Sentry.addBreadcrumb({
            category: 'error-boundary',
            message: `caught in ${this.props.scope ?? 'unknown'}: ${error.message}`,
            level: 'error',
          });
        }
        if (Sentry?.captureException) {
          Sentry.captureException(error, { extra: { componentStack: info.componentStack, scope: this.props.scope } });
        }
      }
    } catch { /* ignore */ }
    // 開発時は console にも出す
    if (Platform.OS === 'web' || __DEV__) {
      console.warn(`[ErrorBoundary:${this.props.scope ?? '?'}] ${error.message}`);
    }
  }

  override render() {
    if (this.state.hasError && this.state.error) {
      const reset = () => this.setState({ hasError: false, error: null });
      if (this.props.fallback) return this.props.fallback(this.state.error, reset);
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: C.bg,
            alignItems: 'center',
            justifyContent: 'center',
            padding: SP['6'],
            gap: SP['3'],
          }}
        >
          <Text style={{ fontSize: 56 }}>⚠️</Text>
          <Text style={[T.h2, { color: C.text, marginBottom: SP['1'] }]}>
            エラーが発生しました
          </Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center', marginBottom: SP['2'] }]}>
            {this.props.scope ? `${this.props.scope} で問題が起きました。` : 'アプリを再起動してください。'}
          </Text>
          <Text style={[T.caption, { color: C.text3, textAlign: 'center', maxWidth: 320 }]}>
            {this.state.error.message}
          </Text>
          <PressableScale
            onPress={reset}
            haptic="tap"
            style={{
              marginTop: SP['4'],
              backgroundColor: C.accent,
              paddingHorizontal: SP['6'],
              paddingVertical: SP['3'],
              borderRadius: 12,
            }}
          >
            <Text style={[T.buttonMd, { color: '#fff' }]}>再試行</Text>
          </PressableScale>
        </View>
      );
    }
    return this.props.children;
  }
}
