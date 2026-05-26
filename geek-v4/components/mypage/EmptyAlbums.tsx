// ============================================================
// components/mypage/EmptyAlbums.tsx
// ============================================================
// アルバムタブが空のときの空状態 (scope ごとにメッセージを変える)。
// UI Polish (Phase 2 / U5): 大胆な illustration 風レイアウトに刷新。
//   - 中央 96x96 の gradient 円 (GRAD.glass) に 48px emoji
//   - h3 title + body caption
//   - PolishedButton variant='gradient' gradient='primary' で CTA
// scope='shared' は CTA = 「友達追加」 → /mypage/friends に誘導。
// ============================================================
//
// レイアウト方針:
// - vertical / horizontal 共に中央寄せ
// - 親 (mypage タブの AlbumsSection 内 etc.) は flex を持っていない場合があるので
//   この component 内では minHeight を持たせて余裕のある空状態にする
// ============================================================

import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { PolishedButton } from '../ui/PolishedButton';
import { GRAD, SP } from '../../design/tokens';
import { C } from '../../design/tokens';
import { T } from '../../design/typography';

export type EmptyAlbumsScope = 'mine' | 'shared' | 'all';

type Props = {
  scope: EmptyAlbumsScope;
};

type Message = {
  emoji: string;
  title: string;
  hint: string;
  cta: string;
  // CTA タップで遷移する path. scope によって変わる (写真追加 or 友達追加)
  to: string;
};

// scope 別の文言と CTA の遷移先。
// - mine:   自分用に作るアルバム → 写真追加 CTA
// - shared: 共有してくれる人が必要 → 友達追加 CTA
// - all:    全体 — 最初の 1 枚を促す
const MESSAGES: Record<EmptyAlbumsScope, Message> = {
  mine: {
    emoji: '📷',
    title: 'まだマイアルバムがありません',
    hint: '思い出を残してみよう',
    cta: '+ 写真を追加',
    to: '/mypage/photo/add',
  },
  shared: {
    emoji: '👥',
    title: 'まだ共有された写真がありません',
    hint: '友達と思い出をシェアしよう',
    cta: '+ 友達追加',
    to: '/mypage/friends',
  },
  all: {
    emoji: '✨',
    title: 'まだ写真がありません',
    hint: '最初の写真を追加してみよう',
    cta: '+ 写真を追加',
    to: '/mypage/photo/add',
  },
};

export function EmptyAlbums({ scope }: Props) {
  const router = useRouter();
  const msg = MESSAGES[scope];

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: SP['10'],
        paddingHorizontal: SP['4'],
        gap: SP['4'],
        minHeight: 320,
      }}
    >
      {/* 96x96 グラデ円 — 中央に大きい emoji を載せる */}
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          // outer glow — accent をうっすら拡散
          shadowColor: C.accent,
          shadowOpacity: 0.25,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        }}
      >
        <LinearGradient
          colors={GRAD.glass}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }}
        />
        <Text style={{ fontSize: 48, lineHeight: 56 }}>{msg.emoji}</Text>
      </View>

      {/* タイトル + キャプション */}
      <View style={{ alignItems: 'center', gap: SP['1'] }}>
        <Text
          style={[
            T.h3,
            { color: C.text, textAlign: 'center', letterSpacing: -0.3 },
          ]}
        >
          {msg.title}
        </Text>
        <Text
          style={[
            T.body,
            { color: C.text2, textAlign: 'center', maxWidth: 320 },
          ]}
        >
          {msg.hint}
        </Text>
      </View>

      {/* CTA — PolishedButton (gradient / primary) */}
      <View style={{ marginTop: SP['1'] }}>
        <PolishedButton
          variant="gradient"
          gradient="primary"
          label={msg.cta}
          onPress={() => router.push(msg.to as never)}
          haptic="confirm"
          size="md"
        />
      </View>
    </View>
  );
}
