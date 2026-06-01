import { View, Text, ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { SkeletonRow } from '../../components/ui/SkeletonRow';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { useObsidianEnabled, postToObsidianNote } from '../../hooks/useObsidian';
import { saveBatchToObsidian, OBSIDIAN_AVAILABLE } from '../../lib/obsidian';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';

type Item = {
  id: string;
  content: string;
  tag_names: string[];
  likes_count: number;
  comments_count: number;
  created_at: string;
  // Post 型に揃えるための optional フィールド
  media_urls?: string[];
  source_url?: string | null;
  kind?: string | null;
};

async function fetchSavedPosts(): Promise<Item[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data: saves } = await supabase
    .from('saves')
    .select('post_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (!saves || saves.length === 0) return [];
  const postIds = saves.map((s: { post_id: string }) => s.post_id);
  const { data: posts } = await supabase
    .from('posts')
    .select('id, content, tag_names, likes_count, comments_count, created_at')
    .in('id', postIds);
  // 保存順を維持
  const map = new Map((posts ?? []).map((p: Item) => [p.id, p]));
  return postIds.map((id) => map.get(id)).filter(Boolean) as Item[];
}

export default function SavedPosts() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const show = useToastStore((s) => s.show);
  const { enabled: obsidianEnabled } = useObsidianEnabled();
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  // 別ユーザーへ永続キャッシュ経由で前ユーザーの保存リストが漏れるのを防ぐ。
  const userId = useAuthStore((s) => s.user?.id);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['saved-posts', userId],
    queryFn: fetchSavedPosts,
    enabled: !!userId,
  });

  const handleBulkExport = async () => {
    if (items.length === 0) {
      show('保存済みの投稿がありません', 'warn');
      return;
    }
    if (bulkProgress) return;
    setBulkProgress({ current: 0, total: items.length });
    try {
      const notes = items.map((p) => postToObsidianNote(p as never));
      const result = await saveBatchToObsidian(notes, {
        delayMs: 400,
        onProgress: (current, total) => setBulkProgress({ current, total }),
      });
      if (result.failed === 0) {
        show(`${result.success} 件すべて Obsidian に送信しました`, 'success');
      } else {
        show(`成功 ${result.success} / 失敗 ${result.failed}`, 'warn');
      }
    } catch (e) {
      // 旧版は例外で setBulkProgress(null) が呼ばれず、UI が永久に
      // 「送信中…」のままロックされる事例があった。finally で必ず解除。
      console.warn('[mypage/saved] bulk export failed:', e);
      show('Obsidian への送信に失敗しました', 'error');
    } finally {
      setBulkProgress(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="保存した投稿" left={<BackButton />} />
      {isLoading ? (
        // skeleton list — ActivityIndicator より「内容が来る」感が出る
        <View style={{ padding: SP['4'] }}>
          <SkeletonRow kind="list-item" count={6} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ padding: SP['4'] }}>
          <EmptyState
            icon={Icon.save}
            title="まだ保存した投稿はありません"
            message="気になる投稿はブックマークしておけば後でじっくり読めます"
            actionLabel="フィードを見る"
            onAction={() => router.push('/(tabs)/feed' as never)}
            tone="amber"
          />
        </View>
      ) : (
        // 最大 100 件保存される可能性 → ScrollView+.map から virtualization へ。
        // 一括 export ボタンは ListHeaderComponent で表示。
        <FlashList
          data={items}
          keyExtractor={(p) => p.id}
          estimatedItemSize={140}
          drawDistance={250}
          removeClippedSubviews
          decelerationRate="fast"
          contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'] }}
          ItemSeparatorComponent={() => <View style={{ height: SP['2'] }} />}
          ListHeaderComponent={
            OBSIDIAN_AVAILABLE && obsidianEnabled && items.length > 0 ? (
              <PressableScale
                onPress={handleBulkExport}
                haptic="confirm"
                disabled={!!bulkProgress}
                style={{
                  padding: SP['3'],
                  backgroundColor: C.accentBg,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.accent + '55',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['2'],
                  opacity: bulkProgress ? 0.6 : 1,
                  marginBottom: SP['2'],
                }}
              >
                <Icon.edit size={18} color={C.accent} strokeWidth={2.2} />
                <Text style={[T.bodyMd, { color: C.accent, fontWeight: '700', flex: 1 }]}>
                  {bulkProgress
                    ? `Obsidian に送信中… ${bulkProgress.current} / ${bulkProgress.total}`
                    : `${items.length} 件をまとめて Obsidian に保存`}
                </Text>
                {bulkProgress && <ActivityIndicator size="small" color={C.accent} />}
              </PressableScale>
            ) : null
          }
          renderItem={({ item: p }) => (
            <PressableScale
              onPress={() => router.push(`/post/${p.id}` as never)}
              haptic="tap"
              style={{
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                gap: SP['2'],
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <Avatar size={20} anonymous />
                <Text style={[T.caption, { color: C.accent }]}>
                  {p.tag_names[0] ? `#${p.tag_names[0]}` : '#雑談'}
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>· {formatRelative(p.created_at)}</Text>
                <View style={{ flex: 1 }} />
                <ObsidianSaveButton note={postToObsidianNote(p as never)} size={16} />
              </View>
              <Text style={[T.body, { color: C.text }]} numberOfLines={3}>{p.content}</Text>
              <View style={{ flexDirection: 'row', gap: SP['3'] }}>
                <Text style={[T.caption, { color: C.text3 }]}>♥ {p.likes_count}</Text>
                <Text style={[T.caption, { color: C.text3 }]}>💬 {p.comments_count}</Text>
              </View>
            </PressableScale>
          )}
        />
      )}
    </View>
  );
}
