// ============================================================
// components/mypage/EmptyFriends.tsx
// ============================================================
// 友達一覧 / リクエストタブの空状態。
// EmptyState を直接使わず、CTA (招待リンク作成) を強調するためカスタム実装。
// kind で文言を切り替える: 'friends' | 'incoming' | 'outgoing'
// ============================================================

import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export type EmptyFriendsKind = 'friends' | 'incoming' | 'outgoing';

type CopySet = {
  title: string;
  message: string;
};

// それぞれの空状態でユーザーに伝える文言は微妙に違う。
// 「申請が来てない」「友達がいない」を同じ文言で出すと作業感が出るので
// 親しみのある言い回しに寄せる。
const COPY: Record<EmptyFriendsKind, CopySet> = {
  friends: {
    title: 'まだ友達がいません',
    message: '招待リンクを送って、最初の友達を見つけよう。',
  },
  incoming: {
    title: '新しい申請はまだ',
    message: '友達からの申請が届くとここに表示されます。',
  },
  outgoing: {
    title: '送信中の申請はありません',
    message: '招待リンクを送ると、ここに進捗が並びます。',
  },
};

type Props = {
  kind?: EmptyFriendsKind;
  onCreateInvite?: () => void;
};

export function EmptyFriends({ kind = 'friends', onCreateInvite }: Props) {
  const copy = COPY[kind];
  const FriendsIcon = Icon.friends;
  return (
    <View
      style={{
        padding: SP['10'],
        alignItems: 'center',
        gap: SP['4'],
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: C.accentBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.accent + '44',
          shadowColor: C.accent,
          shadowOpacity: 0.25,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <FriendsIcon size={44} color={C.accent} strokeWidth={1.8} />
      </View>
      <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
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
      {onCreateInvite && (
        <PressableScale
          onPress={onCreateInvite}
          haptic="confirm"
          style={{
            marginTop: SP['3'],
            paddingHorizontal: SP['5'],
            paddingVertical: SP['3'],
            borderRadius: R.full,
            backgroundColor: C.accent,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
          }}
        >
          <Icon.plus size={18} color="#fff" strokeWidth={2.4} />
          <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
            招待リンクを作る
          </Text>
        </PressableScale>
      )}
    </View>
  );
}
