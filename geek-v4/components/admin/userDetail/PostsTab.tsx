// ============================================================
// userDetail/PostsTab — admin/user/[id] の Tab 1 (投稿一覧)
// ============================================================
// ユーザーの投稿を viewport ごとにカード化 + 個別削除 (確認付き)。
// 親 screen で期間フィルタ済みの posts を受け取る。
// ============================================================
import { useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PressableScale } from '../../ui/PressableScale';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { MiniMetric } from '../MiniMetric';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { formatRelative } from '../../../lib/utils/date';
import { deletePost, type AdminPost } from '../../../lib/api/admin';
import { useToastStore } from '../../../stores/toastStore';
import { UserDetailEmptyState } from './_shared';

const isWeb = Platform.OS === 'web';

export function PostsTab({ posts, userId }: { posts: AdminPost[]; userId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<AdminPost | null>(null);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('投稿を削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-user', userId] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  if (posts.length === 0) {
    return <UserDetailEmptyState icon="📭" title="投稿がありません" hint="この期間の投稿は見つかりません" />;
  }

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
      {posts.map((p, i) => {
        const isRemovingThis = remove.isPending && remove.variables === p.id;
        const visBg =
          p.visibility === 'public' ? C.greenBg :
          p.visibility === 'private' ? C.bg3 : C.amberBg;
        const visColor =
          p.visibility === 'public' ? C.green :
          p.visibility === 'private' ? C.text3 : C.amber;
        return (
          <Animated.View
            key={p.id}
            entering={FadeInDown.duration(220).delay(i * 20)}
            layout={Layout.springify()}
            style={[{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }, SHADOW.card]}
          >
            <PressableScale
              onPress={() => router.push(`/admin/post/${p.id}` as never)}
              haptic="tap"
              style={{ gap: SP['2'], ...(isWeb ? ({ cursor: 'pointer' } as object) : null) }}
            >
              <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={3}>
                {p.content || '(本文なし)'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'], flexWrap: 'wrap' }}>
                <MiniMetric icon="♥" value={p.likes_count} />
                <MiniMetric
                  icon="🚩"
                  value={p.concern_count}
                  accent={p.concern_count > 0 ? C.red : undefined}
                />
                <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(p.created_at)}</Text>
                <View style={{ flex: 1 }} />
                <View
                  style={{
                    paddingHorizontal: SP['2'], paddingVertical: 2,
                    backgroundColor: visBg, borderRadius: R.full,
                    borderWidth: 1, borderColor: visColor + '55',
                  }}
                >
                  <Text style={[T.caption, { color: visColor, fontWeight: '700', fontSize: 10 }]}>
                    {p.visibility}
                  </Text>
                </View>
              </View>
            </PressableScale>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <PressableScale
                onPress={() => setPending(p)}
                haptic="warn"
                disabled={isRemovingThis}
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: 6,
                  backgroundColor: C.redBg, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.red + '55',
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  opacity: isRemovingThis ? 0.6 : 1,
                  ...(isWeb ? ({ cursor: 'pointer' } as object) : null),
                }}
              >
                {isRemovingThis && <ActivityIndicator size="small" color={C.red} />}
                <Text style={[T.smallB, { color: C.red }]}>🗑️ 削除</Text>
              </PressableScale>
            </View>
          </Animated.View>
        );
      })}
      <ConfirmDialog
        visible={pending !== null}
        title="投稿を削除"
        message="この投稿を完全に削除します。元には戻せません。"
        confirmLabel="削除する"
        destructive
        onConfirm={() => {
          if (pending) remove.mutate(pending.id);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}
