// ============================================================
// /settings/account-state — アカウント状態の詳細透明性画面
// ============================================================
// Reddit ガイド #11 「停止/制限はユーザーに対して透明であるべき」を満たすため、
//   - 現在の state (色付きカード)
//   - 現在受けている制限の一覧
//   - 復帰条件 (resolution hint)
//   - 異議申し立て CTA (placeholder — 本実装は別 PR)
// を 1 つの settings 画面に集約する.
//
// 'healthy' の場合も「現在 通常状態です」とポジティブに表示する (隠さない).
// ============================================================
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { useToastStore } from '../../stores/toastStore';
import { useAccountState } from '../../hooks/useAccountState';
import {
  accountStateLabel,
  accountStateShortDescription,
} from '../../lib/api/accountState';
import type { AccountState } from '../../types/models';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

type Tone = {
  bg: string;
  border: string;
  fg: string;
  badgeBg: string;
};

const TONE: Record<AccountState, Tone> = {
  healthy: {
    bg: C.greenBg,
    border: C.green + '55',
    fg: C.green,
    badgeBg: 'rgba(34,211,164,0.18)',
  },
  caution: {
    bg: C.amberBg,
    border: C.amber + '55',
    fg: C.amber,
    badgeBg: 'rgba(245,166,35,0.18)',
  },
  restricted: {
    bg: '#2a1810',
    border: '#FB923C' + '55',
    fg: '#FB923C',
    badgeBg: 'rgba(251,146,60,0.18)',
  },
  warned: {
    bg: C.redBg,
    border: C.red + '66',
    fg: C.red,
    badgeBg: 'rgba(226,75,74,0.20)',
  },
  suspended: {
    bg: '#1a0606',
    border: '#7f1d1d',
    fg: '#FCA5A5',
    badgeBg: 'rgba(127,29,29,0.40)',
  },
};

export default function AccountStateScreen() {
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);
  const { info, isLoading } = useAccountState();

  const state = info.state;
  const tone = TONE[state];
  const label = accountStateLabel(state);
  const desc =
    state === 'healthy'
      ? 'アカウントは現在 通常状態です。すべての機能が制限なくご利用いただけます。'
      : accountStateShortDescription(state);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="アカウント状態" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        {/* loading 状態 — 初回 fetch の間だけ spinner. それ以降は fallback (healthy) で描画される */}
        {isLoading && !info.state ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : null}

        {/* 現在の状態 — 大きめのカードで状態を一目で */}
        <View
          style={{
            padding: SP['5'],
            backgroundColor: tone.bg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: tone.border,
            gap: SP['3'],
            ...SHADOW.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: R.full,
                backgroundColor: tone.badgeBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {state === 'healthy' ? (
                <Icon.check size={28} color={tone.fg} strokeWidth={2.6} />
              ) : (
                <Icon.warn size={28} color={tone.fg} strokeWidth={2.6} />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[T.caption, { color: C.text3, letterSpacing: 0.3 }]}>
                現在の状態
              </Text>
              <Text style={[T.h2, { color: tone.fg }]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </View>
          <Text style={[T.body, { color: C.text2 }]}>{desc}</Text>
        </View>

        {/* 制限一覧 — healthy 以外でのみ表示 */}
        {info.restrictions.length > 0 && (
          <View style={{ gap: SP['3'] }}>
            <Text style={[T.h4, { color: C.text }]}>受けている制限</Text>
            <View
              style={{
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                paddingVertical: SP['2'],
              }}
            >
              {info.restrictions.map((r, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    paddingHorizontal: SP['4'],
                    paddingVertical: SP['3'],
                    gap: SP['3'],
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: C.divider,
                  }}
                >
                  <View
                    style={{
                      marginTop: 6,
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: tone.fg,
                    }}
                  />
                  <Text style={[T.body, { color: C.text, flex: 1 }]}>{r}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 復帰条件 — healthy 以外で resolutionHint があれば表示 */}
        {info.resolutionHint.length > 0 && (
          <View style={{ gap: SP['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Icon.info size={18} color={C.accent} strokeWidth={2.4} />
              <Text style={[T.h4, { color: C.text }]}>復帰条件</Text>
            </View>
            <View
              style={{
                padding: SP['4'],
                backgroundColor: C.accentBg,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.accentSoft,
              }}
            >
              <Text style={[T.body, { color: C.text }]}>{info.resolutionHint}</Text>
            </View>
          </View>
        )}

        {/* 異議申し立て CTA — 'warned' / 'suspended' / 'restricted' のときに出す.
            実装は別 PR (placeholder). toast で受付済を表示する. */}
        {(state === 'warned' || state === 'suspended' || state === 'restricted') && (
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.h4, { color: C.text }]}>納得できない場合</Text>
            <Text style={[T.small, { color: C.text2 }]}>
              現在の制限が誤りだと思われる場合は、運営に異議申し立てができます。
              担当者が状況を再確認し、状態の見直しを行います。
            </Text>
            <PressableScale
              onPress={() => {
                // 本実装は別 PR — 今は受付完了の placeholder toast を表示する
                showToast('異議申し立てを受け付けました。運営から後ほど連絡します。', 'info');
              }}
              haptic="confirm"
              accessibilityRole="button"
              accessibilityLabel="異議申し立てを送信する"
              style={{
                marginTop: SP['2'],
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: SP['2'],
                padding: SP['4'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border2,
              }}
            >
              <Icon.send size={18} color={C.accent} strokeWidth={2.4} />
              <Text style={[T.smallM, { color: C.accent, fontWeight: '700' }]}>
                異議申し立てを送信
              </Text>
            </PressableScale>
          </View>
        )}

        {/* footer note — 「なぜ制限されるのか」の透明性 */}
        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Icon.shield size={16} color={C.text3} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>
              アカウント状態のしくみ
            </Text>
          </View>
          <Text style={[T.small, { color: C.text3 }]}>
            アカウント状態は、自分の投稿に対する「気になる」評価の比率や運営判断に基づいて自動で算出されます。
            グレース期間 (投稿 5 件未満) は対象外となり、通常状態が維持されます。
            状態が変化したときは通知が届きます。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
