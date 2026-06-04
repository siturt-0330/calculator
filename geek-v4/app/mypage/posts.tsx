import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { withApiTimeout } from '../../lib/withApiTimeout';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { invalidateFeedPage } from '../../lib/cacheUpdates/feedPagePatcher';
import { useState } from 'react';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';

type Item = {
  id: string;
  content: string;
  tag_names: string[];
  likes_count: number;
  comments_count: number;
  is_public: boolean;
  created_at: string;
};

async function fetchMyPosts(): Promise<Item[]> {
  // de-anon Phase2: author_id を client で使わず auth.uid() ベースの RPC (0117_get_my_posts) で
  // 自分の投稿を取得する。2b で posts.author_id を REVOKE しても壊れない (列フィルタにも SELECT 権が
  // 要るため .eq('author_id', ...) は permission denied になる)。非公開投稿も自分の分は含まれる。
  const { data, error } = await withApiTimeout(
    supabase.rpc('get_my_posts', { p_limit: 100 }),
    'mypage.get_my_posts',
    8000,
  );
  if (error) {
    console.warn('[fetchMyPosts] rpc error:', error.message);
    return [];
  }
  return (Array.isArray(data) ? data : []) as Item[];
}

export default function MyPosts() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['my-posts', user?.id],
    queryFn: () => fetchMyPosts(),
    enabled: !!user,
  });

  const { mutate: deletePost, isPending: deleting } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('posts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-posts'] });
      // マイページ本体タブ (['user-posts']) とフィードキャッシュも更新しないと削除済み投稿が残る。
      qc.invalidateQueries({ queryKey: ['user-posts'] });
      invalidateFeedPage(qc);
      show('投稿を削除しました', 'success');
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="自分の投稿" left={<BackButton />} />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'], gap: SP['2'] }}
        >
          {items.length === 0 ? (
            <EmptyState
              icon={Icon.edit}
              title="まだ投稿していません"
              message="最初の一投をしてみよう"
              actionLabel="投稿する"
              onAction={() => router.push('/post/create' as never)}
              tone="accent"
            />
          ) : (
            <>
              {/* 件数ヘッダー — 一覧の全体像が一目で分かる。新しい順で表示中であることも明示。 */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: SP['1'],
                marginBottom: SP['1'],
                gap: SP['2'],
              }}>
                <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>
                  全 {items.length} 件
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>· 新しい順</Text>
              </View>
              {items.map((p) => (
              <View
                key={p.id}
                style={{
                  padding: SP['3'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  gap: SP['2'],
                }}
              >
                <PressableScale onPress={() => router.push(`/post/${p.id}` as never)} haptic="tap">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                    {!p.is_public && (
                      <View style={{
                        paddingHorizontal: SP['2'], paddingVertical: 2,
                        backgroundColor: C.bg3, borderRadius: R.sm,
                      }}>
                        <Text style={[T.caption, { color: C.text3 }]}>🔒 非公開</Text>
                      </View>
                    )}
                    {p.tag_names[0] && (
                      <Text style={[T.caption, { color: C.accent }]}>#{p.tag_names[0]}</Text>
                    )}
                    <Text style={[T.caption, { color: C.text3 }]}>· {formatRelative(p.created_at)}</Text>
                  </View>
                  <Text style={[T.body, { color: C.text, marginTop: SP['1'] }]} numberOfLines={3}>{p.content}</Text>
                  <View style={{ flexDirection: 'row', gap: SP['3'], marginTop: SP['1'] }}>
                    <Text style={[T.caption, { color: C.pink }]}>♥ {p.likes_count}</Text>
                    <Text style={[T.caption, { color: C.text3 }]}>💬 {p.comments_count}</Text>
                  </View>
                </PressableScale>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: SP['2'] }}>
                  <ObsidianSaveButton note={postToObsidianNote(p as never)} size={16} />
                  <PressableScale
                    onPress={() => setDeleteId(p.id)}
                    haptic="warn"
                    style={{
                      paddingHorizontal: SP['3'], paddingVertical: SP['1'],
                      backgroundColor: C.redBg, borderRadius: R.full,
                      borderWidth: 1, borderColor: C.red + '44',
                    }}
                  >
                    <Text style={[T.caption, { color: C.red }]}>削除</Text>
                  </PressableScale>
                </View>
              </View>
            ))}
            </>
          )}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={!!deleteId}
        title="この投稿を削除しますか？"
        message="削除した投稿は元に戻せません。"
        confirmLabel={deleting ? '削除中…' : '削除する'}
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          // 連打で複数 mutation が走らないよう isPending 中はスキップ
          if (!deleteId || deleting) return;
          deletePost(deleteId);
          setDeleteId(null);
        }}
      />
    </View>
  );
}
