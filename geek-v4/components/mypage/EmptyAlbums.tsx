// ============================================================
// components/mypage/EmptyAlbums.tsx
// ============================================================
// アルバムタブが空のときの空状態 (scope ごとにメッセージを変える)。
// CTA は scope='shared' を除き「+ 写真を追加」で /mypage/photo/add に。
// shared scope は CTA を出さない (自分の操作で増えるものではないため)。
// ============================================================

import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export type EmptyAlbumsScope = 'mine' | 'shared' | 'all';

type Props = {
  scope: EmptyAlbumsScope;
};

type Message = {
  title: string;
  hint: string;
  cta?: string;
};

const MESSAGES: Record<EmptyAlbumsScope, Message> = {
  all: {
    title: 'マイアルバムを作って思い出を残そう',
    hint: 'お気に入りの写真を 1 枚追加するところから',
    cta: '+ 写真を追加',
  },
  mine: {
    title: 'まだ自分だけの写真はありません',
    hint: '非公開で残したい思い出をここに集めよう',
    cta: '+ 写真を追加',
  },
  shared: {
    title: '共有中の写真はまだありません',
    hint: '写真をアップロードして友達と共有してみよう',
  },
};

export function EmptyAlbums({ scope }: Props) {
  const router = useRouter();
  const msg = MESSAGES[scope];

  return (
    <View
      style={{
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        paddingVertical: SP['6'],
        paddingHorizontal: SP['4'],
        alignItems: 'center',
        gap: SP['3'],
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: C.bg3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon.camera size={26} color={C.text3} strokeWidth={1.8} />
      </View>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={[T.bodyB, { color: C.text, textAlign: 'center' }]}>{msg.title}</Text>
        <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>{msg.hint}</Text>
      </View>
      {msg.cta && (
        <PressableScale
          onPress={() => router.push('/mypage/photo/add' as never)}
          haptic="confirm"
          style={{
            marginTop: SP['1'],
            paddingHorizontal: SP['4'],
            paddingVertical: SP['2'] + 2,
            borderRadius: R.full,
            backgroundColor: C.accent,
          }}
        >
          <Text style={[T.smallB, { color: '#fff', letterSpacing: 0.3 }]}>{msg.cta}</Text>
        </PressableScale>
      )}
    </View>
  );
}
