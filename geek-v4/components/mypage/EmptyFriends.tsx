// ============================================================
// components/mypage/EmptyFriends.tsx
// ============================================================
// 友達一覧 / リクエストタブの空状態。
// UI Polish (Phase 2 / U5): 大胆な illustration 風レイアウトに刷新。
//   - 中央 96x96 の gradient 円 (GRAD.glass) に 48px emoji
//   - h3 title + body caption
//   - PolishedButton variant='gradient' gradient='primary' で「招待リンクを作る」
// kind 別に emoji / 文言を切り替え:
//   - friends:  👥  「まだ友達がいません」
//   - incoming: 💌  「新しい友達申請はありません」
//   - outgoing: 📤  「申請中のリクエストはありません」
// ============================================================

import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { PolishedButton } from '../ui/PolishedButton';
import { GRAD, SP } from '../../design/tokens';
import { C } from '../../design/tokens';
import { T } from '../../design/typography';

export type EmptyFriendsKind = 'friends' | 'incoming' | 'outgoing';

type CopySet = {
  emoji: string;
  title: string;
  message: string;
  cta: string;
};

// それぞれの空状態でユーザーに伝える文言は微妙に違う。
// 「申請が来てない」「友達がいない」を同じ文言で出すと作業感が出るので
// 親しみのある言い回しに寄せる。
const COPY: Record<EmptyFriendsKind, CopySet> = {
  friends: {
    emoji: '👥',
    title: 'まだ友達がいません',
    message: '招待リンクで友達を誘おう',
    cta: '+ 招待リンクを作る',
  },
  incoming: {
    emoji: '💌',
    title: '新しい友達申請はありません',
    message: '招待リンクを送って待とう',
    cta: '招待リンクを作る',
  },
  outgoing: {
    emoji: '📤',
    title: '申請中のリクエストはありません',
    message: '友達を誘ってみよう',
    cta: '招待リンクを作る',
  },
};

type Props = {
  kind?: EmptyFriendsKind;
  // 既存 caller (app/mypage/friends/index.tsx) は `onCreateInvite` を渡す。
  // 後方互換のため optional. 未指定なら `/mypage/friends/invite` に遷移する default 動作。
  onCreateInvite?: () => void;
};

export function EmptyFriends({ kind = 'friends', onCreateInvite }: Props) {
  const router = useRouter();
  const copy = COPY[kind];

  // CTA — caller が onCreateInvite を渡してくれていればそちら、無ければ default で
  // invite 画面へ遷移する (spec § 6: incoming タブでも CTA を出す)。
  const handleCta = onCreateInvite
    ? onCreateInvite
    : () => router.push('/mypage/friends/invite' as never);

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
        <Text style={{ fontSize: 48, lineHeight: 56 }}>{copy.emoji}</Text>
      </View>

      {/* タイトル + キャプション */}
      <View style={{ alignItems: 'center', gap: SP['1'] }}>
        <Text
          style={[
            T.h3,
            { color: C.text, textAlign: 'center', letterSpacing: -0.3 },
          ]}
        >
          {copy.title}
        </Text>
        <Text
          style={[
            T.body,
            { color: C.text2, textAlign: 'center', maxWidth: 320 },
          ]}
        >
          {copy.message}
        </Text>
      </View>

      {/* CTA */}
      <View style={{ marginTop: SP['1'] }}>
        <PolishedButton
          variant="gradient"
          gradient="primary"
          label={copy.cta}
          onPress={handleCta}
          haptic="confirm"
          size="md"
        />
      </View>
    </View>
  );
}
