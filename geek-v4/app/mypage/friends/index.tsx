// ============================================================
// app/mypage/friends/index.tsx
// ============================================================
// 友達一覧 + 申請管理 (incoming / outgoing) を 1 画面 3 タブで提供。
// - TopBar: 戻る + 右に「招待」ボタン (招待コード生成画面へ)
// - SegmentedControl で 3 タブ切替
// - 各タブで FriendListItem / EmptyFriends を render
// - 承認 / 拒否 / キャンセル mutation は hook 経由
// ============================================================

import { useState } from 'react';
import { View, ScrollView, ActivityIndicator, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { FriendListItem } from '../../../components/mypage/FriendListItem';
import { EmptyFriends } from '../../../components/mypage/EmptyFriends';
import {
  useMyFriends,
  usePendingRequests,
  useAcceptFriend,
  useDeclineFriend,
  useUnfriend,
} from '../../../hooks/useFriends';
import { useToastStore } from '../../../stores/toastStore';
import { Icon } from '../../../constants/icons';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';

type Tab = 'friends' | 'incoming' | 'outgoing';

export default function MyFriendsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const show = useToastStore((s) => s.show);
  const [tab, setTab] = useState<Tab>('friends');

  const { friends, isLoading: loadingFriends } = useMyFriends();
  const {
    incoming,
    outgoing,
    isLoading: loadingPending,
  } = usePendingRequests();

  const accept = useAcceptFriend();
  const decline = useDeclineFriend();
  const cancel = useUnfriend();

  // mutation を friendshipId ごとに「処理中か」判定するため、現在 mutate 中の id を覚える。
  // (useMutation は globally 1 つの状態しか持たないので、複数行で同時 mutation 中の
  //  どれが処理中か個別に表示するには id を持つ必要がある)
  const [busyId, setBusyId] = useState<string | null>(null);

  const isLoading =
    (tab === 'friends' && loadingFriends) ||
    ((tab === 'incoming' || tab === 'outgoing') && loadingPending);

  const handleAccept = (id: string) => {
    setBusyId(id);
    accept.mutate(id, {
      onSuccess: () => show('友達になりました', 'success'),
      onError: (e) => {
        const msg = e instanceof Error ? e.message : '承認に失敗しました';
        show(msg, 'error');
      },
      onSettled: () => setBusyId(null),
    });
  };

  const handleDecline = (id: string) => {
    setBusyId(id);
    decline.mutate(id, {
      onSuccess: () => show('申請を拒否しました', 'info'),
      onError: (e) => {
        const msg = e instanceof Error ? e.message : '拒否に失敗しました';
        show(msg, 'error');
      },
      onSettled: () => setBusyId(null),
    });
  };

  const handleCancel = (id: string) => {
    setBusyId(id);
    cancel.mutate(id, {
      onSuccess: () => show('申請を取り消しました', 'info'),
      onError: (e) => {
        const msg = e instanceof Error ? e.message : 'キャンセルに失敗しました';
        show(msg, 'error');
      },
      onSettled: () => setBusyId(null),
    });
  };

  const handleFriendPress = () => {
    // Phase 2: profile 画面実装後に router.push('/profile/<id>') に差し替え。
    // 現状は CTA を出すと誤解を生むので軽い toast で意図を伝える。
    show('プロフィール画面は近日公開です', 'info');
  };

  const segmentOptions: { value: Tab; label: string }[] = [
    { value: 'friends', label: `友達${friends.length ? ` ${friends.length}` : ''}` },
    {
      value: 'incoming',
      label: `申請${incoming.length ? ` ${incoming.length}` : ''}`,
    },
    {
      value: 'outgoing',
      label: `送信${outgoing.length ? ` ${outgoing.length}` : ''}`,
    },
  ];

  // 右上の「招待」button
  const inviteButton = (
    <PressableScale
      onPress={() => router.push('/mypage/friends/invite' as never)}
      haptic="tap"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['1'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['2'],
        borderRadius: R.full,
        backgroundColor: C.accent,
      }}
      accessibilityLabel="友達を招待"
    >
      <Icon.plus size={16} color="#fff" strokeWidth={2.4} />
      <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>招待</Text>
    </PressableScale>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="友達" left={<BackButton />} right={inviteButton} />

      <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'] }}>
        <SegmentedControl<Tab>
          options={segmentOptions}
          value={tab}
          onChange={setTab}
        />
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['10'],
            gap: SP['2'],
          }}
        >
          {tab === 'friends' &&
            (friends.length === 0 ? (
              <EmptyFriends
                kind="friends"
                onCreateInvite={() =>
                  router.push('/mypage/friends/invite' as never)
                }
              />
            ) : (
              friends.map((f) => (
                <FriendListItem
                  key={f.id}
                  friendship={f}
                  mode="friend"
                  onPress={handleFriendPress}
                  busy={busyId === f.id}
                />
              ))
            ))}

          {tab === 'incoming' &&
            (incoming.length === 0 ? (
              <EmptyFriends kind="incoming" />
            ) : (
              incoming.map((f) => (
                <FriendListItem
                  key={f.id}
                  friendship={f}
                  mode="incoming"
                  onAccept={() => handleAccept(f.id)}
                  onDecline={() => handleDecline(f.id)}
                  busy={busyId === f.id}
                />
              ))
            ))}

          {tab === 'outgoing' &&
            (outgoing.length === 0 ? (
              <EmptyFriends
                kind="outgoing"
                onCreateInvite={() =>
                  router.push('/mypage/friends/invite' as never)
                }
              />
            ) : (
              outgoing.map((f) => (
                <FriendListItem
                  key={f.id}
                  friendship={f}
                  mode="outgoing"
                  onCancel={() => handleCancel(f.id)}
                  busy={busyId === f.id}
                />
              ))
            ))}
        </ScrollView>
      )}
    </View>
  );
}
