import { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeIn, Layout } from 'react-native-reanimated';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import { formatRelative } from '../../lib/utils/date';

// ============================================================
// 運営からのお知らせ (ユーザー側) — /mypage/messages
// ============================================================
// 受信した admin_messages の一覧。 RLS で recipient_id = auth.uid() の
// rows だけが返るので追加フィルタは不要。タップで inline 展開し、未読の
// 場合は read_at をその場で更新する (optimistic — UI は即時切り替え)。
// ============================================================

type Message = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

async function fetchMyAdminMessages(userId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('admin_messages')
    .select('id, title, body, read_at, created_at')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Message[];
}

export default function MypageMessagesScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const { show } = useToastStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: messages = [], isLoading, error, refetch } = useQuery({
    queryKey: ['admin-messages', user?.id],
    queryFn: () => fetchMyAdminMessages(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  // 行タップ → 展開トグル + 未読なら read_at を now() で UPDATE
  // optimistic update: cache を即時書き換えて UI を切り替える。
  // 失敗時は invalidate で正しい値に戻す (失敗自体は稀なので toast だけ出す)。
  const onToggle = useCallback(
    (msg: Message) => {
      setExpandedId((prev) => (prev === msg.id ? null : msg.id));

      if (msg.read_at !== null) return; // 既読なら何もしない
      const now = new Date().toISOString();

      // optimistic cache update
      qc.setQueryData<Message[]>(['admin-messages', user?.id], (old) =>
        old?.map((m) => (m.id === msg.id ? { ...m, read_at: now } : m)) ?? [],
      );
      // unread count バッジ用のキャッシュも更新 (mypage の Row の dot 用)
      qc.setQueryData<number>(['admin-messages-unread-count', user?.id], (old) =>
        Math.max(0, (old ?? 1) - 1),
      );

      void supabase
        .from('admin_messages')
        .update({ read_at: now })
        .eq('id', msg.id)
        .then(({ error: updErr }) => {
          if (updErr) {
            show('既読化に失敗しました', 'error');
            void qc.invalidateQueries({ queryKey: ['admin-messages', user?.id] });
            void qc.invalidateQueries({
              queryKey: ['admin-messages-unread-count', user?.id],
            });
          }
        });
    },
    [qc, show, user?.id],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="運営からのお知らせ" left={<BackButton />} />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={Icon.warn}
            title="お知らせを取得できませんでした"
            message="ネットワーク状況を確認してもう一度お試しください。"
            actionLabel="再読み込み"
            onAction={() => void refetch()}
            tone="amber"
          />
        </View>
      ) : messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={Icon.bell}
            title="メッセージはありません"
            message="運営からのお知らせが届くと、ここに表示されます。"
            tone="accent"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['10'],
            gap: SP['2'],
          }}
        >
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              expanded={expandedId === m.id}
              onPress={() => onToggle(m)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ============================================================
// 1 行 — 未読は bold + accent dot で目立たせる
// ============================================================
function MessageRow({
  message,
  expanded,
  onPress,
}: {
  message: Message;
  expanded: boolean;
  onPress: () => void;
}) {
  const unread = message.read_at === null;
  return (
    <Animated.View layout={Layout.duration(180)}>
      <PressableScale
        onPress={onPress}
        haptic="tap"
        scaleValue={0.995}
        style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          // 未読は accent 寄りの border、既読は通常 border
          borderColor: unread ? C.accent + '55' : C.border,
          gap: SP['2'],
        }}
      >
        {/* 1 行目: 未読 dot + title + 時間 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          {unread && (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: C.accent,
              }}
            />
          )}
          <Text
            style={[
              unread ? T.bodyB : T.body,
              { color: unread ? C.text : C.text2, flex: 1 },
            ]}
            numberOfLines={1}
          >
            {message.title}
          </Text>
          <Text style={[T.caption, { color: C.text4 }]}>
            {formatRelative(message.created_at)}
          </Text>
        </View>

        {/* 2 行目: 本文 (折り畳み時は冒頭 2 行のみ、展開時は全文) */}
        {expanded ? (
          <Animated.View entering={FadeIn.duration(160)}>
            <Text style={[T.body, { color: C.text, lineHeight: 24 }]}>
              {message.body}
            </Text>
          </Animated.View>
        ) : (
          <Text style={[T.small, { color: C.text3 }]} numberOfLines={2}>
            {message.body}
          </Text>
        )}
      </PressableScale>
    </Animated.View>
  );
}
