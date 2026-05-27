// ============================================================
// AccountStateCard — マイページに出す「アカウント制限の透明性」Card
// ============================================================
// Reddit ガイド #11: アカウント制限はユーザーに対して透明であるべき.
//
// - account_state が 'healthy' のときは null render (画面を散らかさない)
// - それ以外は色付きの目立つ Card を hero 直下に挿入し、
//   「現状」と「詳細を見る」CTA だけを最小限に表示する
//
// state ごとの色トーン:
//   caution     → amber (注意)
//   restricted  → orange (制限)
//   warned      → red    (停止予告)
//   suspended   → dark red (停止)
//
// CTA を押すと `/settings/account-state` (詳細画面) に遷移する.
// ============================================================
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAccountState } from '../../hooks/useAccountState';
import {
  accountStateLabel,
  accountStateShortDescription,
} from '../../lib/api/accountState';
import type { AccountState } from '../../types/models';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

// state 別の表示色プリセット
type Tone = {
  bg: string;        // Card 背景色
  border: string;    // Card 枠色
  fg: string;        // 見出し / icon の前景色
  badgeBg: string;   // Pill 風 badge 背景
};

const TONE: Record<Exclude<AccountState, 'healthy'>, Tone> = {
  // amber 寄り — 注意
  caution: {
    bg: C.amberBg,
    border: C.amber + '55',
    fg: C.amber,
    badgeBg: 'rgba(245,166,35,0.18)',
  },
  // orange (amber と red の中間トーン) — 制限中
  restricted: {
    bg: '#2a1810',
    border: '#FB923C' + '55',
    fg: '#FB923C',
    badgeBg: 'rgba(251,146,60,0.18)',
  },
  // red — 停止予告
  warned: {
    bg: C.redBg,
    border: C.red + '66',
    fg: C.red,
    badgeBg: 'rgba(226,75,74,0.20)',
  },
  // dark red — 停止
  suspended: {
    bg: '#1a0606',
    border: '#7f1d1d',
    fg: '#FCA5A5',
    badgeBg: 'rgba(127,29,29,0.40)',
  },
};

export function AccountStateCard() {
  const router = useRouter();
  const { info } = useAccountState();
  const state = info.state;

  // healthy ならカード自体を出さない (画面を綺麗に保つ最重要要件)
  if (state === 'healthy') return null;

  const tone = TONE[state];
  const label = accountStateLabel(state);
  const desc = accountStateShortDescription(state);

  return (
    <PressableScale
      onPress={() => router.push('/settings/account-state' as never)}
      haptic="warn"
      accessibilityRole="button"
      accessibilityLabel={`アカウント状態: ${label}. 詳細を確認するにはタップ`}
      style={{
        marginHorizontal: SP['4'],
        marginTop: SP['3'],
        padding: SP['4'],
        backgroundColor: tone.bg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: tone.border,
        gap: SP['3'],
        ...SHADOW.sm,
      }}
    >
      {/* 1 段目: icon + state badge + chevron */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: R.full,
            backgroundColor: tone.badgeBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.warn size={22} color={tone.fg} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.h4, { color: tone.fg }]} numberOfLines={1}>
            アカウント{label}
          </Text>
          <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
            {desc}
          </Text>
        </View>
        <Icon.chevronR size={20} color={tone.fg} strokeWidth={2.2} />
      </View>

      {/* 2 段目: CTA hint (chevron だけだと「タップで遷移する」と気付かれにくいので
          明示的に "詳細を見る" のラベルを置く) */}
      <View
        style={{
          paddingTop: SP['2'],
          borderTopWidth: 1,
          borderTopColor: tone.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: SP['1'],
        }}
      >
        <Text style={[T.smallM, { color: tone.fg, fontWeight: '700' }]}>
          詳細を見る
        </Text>
        <Icon.chevronR size={14} color={tone.fg} strokeWidth={2.4} />
      </View>
    </PressableScale>
  );
}
