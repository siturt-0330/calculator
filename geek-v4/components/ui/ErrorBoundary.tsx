import React from 'react';
import { View, Text, Platform } from 'react-native';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';

type State = { hasError: boolean; error: Error | null; remountKey: number };

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
    this.state = { hasError: false, error: null, remountKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
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
      // ★ 2026-06-14: 「再試行を押しても何も起きない」修正。
      //   hasError を false に戻すだけだと、原因(失敗した query / 不正データ等)が
      //   残っていると子ツリーが再 render で即同じ例外を投げ直す → 体感「無反応」。
      //   確実に復帰させるため web は full reload、native は remountKey を進めて
      //   子ツリーを完全に作り直す(全 effect / fetch を再実行させる)。
      const reset = () => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.location.reload();
          return;
        }
        this.setState((s) => ({ hasError: false, error: null, remountKey: s.remountKey + 1 }));
      };
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
          {/* 本文は AppText (Dynamic Type 部分対応) — OS 文字サイズ設定に 1.6 倍まで追従 */}
          <AppText style={[T.body, { color: C.text2, textAlign: 'center', marginBottom: SP['2'], maxWidth: 320 }]}>
            {/* ★ 2026-06-12: 本番でユーザーに見せる文言は平易な日本語のみ。
                  Apple HIG「Alerts」: 「明確な原因 + 解決策」。技術詳細 (error.message) は __DEV__ 限定。
                  生の error.message は英文 stack / Supabase error / "Network request failed" 等が
                  そのままユーザーに到達してしまうため必ず gate する。 */}
            もう一度お試しいただくか、解消しない場合はお問い合わせからご連絡ください
          </AppText>
          {__DEV__ && (
            <Text
              style={[T.caption, { color: C.text3, textAlign: 'center', maxWidth: 320, marginTop: SP['1'] }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              [dev] {this.state.error.message}
            </Text>
          )}
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
    // remountKey を key にした Fragment で children を包む。native の reset 時に
    // key が変わって子ツリーが remount される(web は reload するため key は不変)。
    return <React.Fragment key={this.state.remountKey}>{this.props.children}</React.Fragment>;
  }
}
