// ============================================================
// app/mypage/saved.tsx — 保存した投稿 (コレクション対応・全面刷新)
// ------------------------------------------------------------
// 旧版は生の saves をフラット表示するだけで、せっかく実装済みの
// bookmark_collections (フォルダ) 機能が UI に一切出ていなかった。
//
// 刷新点:
//   1. コレクション(フォルダ)を横スクロールのフィルタチップで表面化
//      (すべて / 未分類 / 各コレクション、件数バッジ付き)
//   2. 各カードの「···」から、その投稿をコレクションに移動 / 未分類へ戻す /
//      保存解除 / 新規コレクション作成
//   3. 保存内容の検索 (本文・タグを対象にクライアント側フィルタ)
//   4. メディアサムネ付きのリッチカード
//   5. Obsidian 一括 export は維持
//
// レイアウト注意:
//   横スクロール (ScrollView/FlashList) を縦 FlashList の「兄弟」に置くと
//   web で縦 FlashList の高さが 0 に潰れてカードが出ない。そこでチップは
//   FlashList の ListHeaderComponent に内包し、画面直下の兄弟は検索 (固定) と
//   FlashList のみにする (= 旧実装の TopBar+FlashList 構造を踏襲)。
//   検索 TextInput はヘッダーに入れると focus を失いやすいので固定兄弟に置く。
// ============================================================
import {
  View,
  Text,
  TextInput,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { SkeletonRow } from '../../components/ui/SkeletonRow';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { useObsidianEnabled, postToObsidianNote } from '../../hooks/useObsidian';
import { saveBatchToObsidian, OBSIDIAN_AVAILABLE } from '../../lib/obsidian';
import { useCollections, useCreateCollection } from '../../hooks/useBookmarks';
import { saveToCollection } from '../../lib/api/bookmarks';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|3gp)(\?|#|$)/i;

type SavedItem = {
  id: string;
  content: string;
  tag_names: string[];
  likes_count: number;
  comments_count: number;
  created_at: string;
  media_urls?: string[] | null;
  video_urls?: string[] | null;
  collection_id: string | null;
};

// 'all' = 全保存 / 'uncategorized' = 未分類 / それ以外 = collection id (番兵値+任意の id)
type FilterKey = string;

async function fetchSavedRich(): Promise<SavedItem[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data: saves } = await supabase
    .from('saves')
    .select('post_id, collection_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (!saves || saves.length === 0) return [];
  const rows = saves as Array<{ post_id: string; collection_id: string | null; created_at: string }>;
  const postIds = rows.map((s) => s.post_id);
  const collById = new Map(rows.map((s) => [s.post_id, s.collection_id ?? null]));
  const { data: posts } = await supabase
    .from('posts')
    .select('id, content, tag_names, likes_count, comments_count, created_at, media_urls, video_urls')
    .in('id', postIds);
  const map = new Map((posts ?? []).map((p) => [(p as { id: string }).id, p]));
  // 保存順 (saves.created_at desc) を維持
  return postIds
    .map((id) => {
      const p = map.get(id) as Omit<SavedItem, 'collection_id'> | undefined;
      if (!p) return null;
      return { ...p, collection_id: collById.get(id) ?? null } as SavedItem;
    })
    .filter(Boolean) as SavedItem[];
}

export default function SavedPosts() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const { enabled: obsidianEnabled } = useObsidianEnabled();
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  // 別ユーザーへ永続キャッシュ経由で前ユーザーの保存リストが漏れるのを防ぐ。
  const userId = useAuthStore((s) => s.user?.id);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['saved-rich', userId],
    queryFn: fetchSavedRich,
    enabled: !!userId,
  });
  const { collections } = useCollections();
  const createCollection = useCreateCollection();

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  // コレクション移動ピッカー対象の投稿 (null = 閉じている)
  const [pickerFor, setPickerFor] = useState<SavedItem | null>(null);

  // ----- フィルタ + 検索 -----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (filter === 'uncategorized' && p.collection_id !== null) return false;
      if (filter !== 'all' && filter !== 'uncategorized' && p.collection_id !== filter) return false;
      if (q.length > 0) {
        const hay = `${p.content} ${(p.tag_names ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, search]);

  // 件数 (チップのバッジ用)
  const counts = useMemo(() => {
    const byCol = new Map<string, number>();
    let uncategorized = 0;
    for (const p of items) {
      if (p.collection_id === null) uncategorized += 1;
      else byCol.set(p.collection_id, (byCol.get(p.collection_id) ?? 0) + 1);
    }
    return { all: items.length, uncategorized, byCol };
  }, [items]);

  // ----- コレクション移動 / 未分類化 -----
  const moveMut = useMutation({
    mutationFn: ({ postId, collectionId }: { postId: string; collectionId: string | null }) =>
      saveToCollection(postId, collectionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-rich', userId] });
      qc.invalidateQueries({ queryKey: ['bookmark-collections'] });
    },
    onError: () => show('移動に失敗しました', 'error'),
  });

  // ----- 保存解除 (saves から削除) -----
  const unsaveMut = useMutation({
    mutationFn: async (postId: string) => {
      if (!userId) return;
      const { error } = await supabase.from('saves').delete().eq('user_id', userId).eq('post_id', postId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-rich', userId] });
      qc.invalidateQueries({ queryKey: ['bookmark-collections'] });
      qc.invalidateQueries({ queryKey: ['my-saves'] });
      show('保存を解除しました', 'success');
    },
    onError: () => show('解除に失敗しました', 'error'),
  });

  const handleBulkExport = async () => {
    if (filtered.length === 0) {
      show('対象の投稿がありません', 'warn');
      return;
    }
    if (bulkProgress) return;
    setBulkProgress({ current: 0, total: filtered.length });
    try {
      const notes = filtered.map((p) => postToObsidianNote(p as never));
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
      console.warn('[mypage/saved] bulk export failed:', e);
      show('Obsidian への送信に失敗しました', 'error');
    } finally {
      setBulkProgress(null);
    }
  };

  // チップ用データ (すべて / 未分類 / 各コレクション)
  const chips = useMemo(
    () => [
      { key: 'all' as FilterKey, label: 'すべて', emoji: '🗂', count: counts.all },
      { key: 'uncategorized' as FilterKey, label: '未分類', emoji: '📄', count: counts.uncategorized },
      ...collections.map((c) => ({
        key: c.id as FilterKey,
        label: c.name,
        emoji: c.emoji,
        count: counts.byCol.get(c.id) ?? c.bookmark_count ?? 0,
      })),
    ],
    [collections, counts],
  );

  // FlashList のヘッダー: コレクションチップ + Obsidian 一括ボタン。
  // (横 ScrollView は縦 FlashList の兄弟に置くと web で高さが 0 に潰れるため
  //  ヘッダーに内包する)
  const listHeader = (
    <View style={{ paddingBottom: SP['1'] }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: SP['2'], paddingVertical: SP['2'] }}
      >
        {chips.map((c) => {
          const active = filter === c.key;
          return (
            <PressableScale
              key={c.key}
              onPress={() => setFilter(c.key)}
              haptic="select"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                borderRadius: R.full,
                backgroundColor: active ? C.accentBg : C.bg2,
                borderWidth: 1,
                borderColor: active ? C.accent : C.border,
              }}
            >
              <Text style={{ fontSize: 13 }}>{c.emoji}</Text>
              <Text style={[T.smallM, { color: active ? C.accent : C.text }]} numberOfLines={1}>
                {c.label}
              </Text>
              <View
                style={{
                  minWidth: 18,
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                  borderRadius: R.full,
                  backgroundColor: active ? C.accent : C.bg3,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '800', color: active ? '#fff' : C.text3 }}>
                  {c.count}
                </Text>
              </View>
            </PressableScale>
          );
        })}
      </ScrollView>

      {OBSIDIAN_AVAILABLE && obsidianEnabled && filtered.length > 0 ? (
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
            marginTop: SP['1'],
            marginBottom: SP['2'],
          }}
        >
          <Icon.edit size={18} color={C.accent} strokeWidth={2.2} />
          <Text style={[T.bodyMd, { color: C.accent, fontWeight: '700', flex: 1 }]}>
            {bulkProgress
              ? `Obsidian に送信中… ${bulkProgress.current} / ${bulkProgress.total}`
              : `${filtered.length} 件をまとめて Obsidian に保存`}
          </Text>
          {bulkProgress && <ActivityIndicator size="small" color={C.accent} />}
        </PressableScale>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="保存済み" left={<BackButton />} />

      {/* feed.tsx と同じく「flex:1 の中間コンテナ直下に FlashList」構造にする。
          (FlashList を個別の flex ラッパーで囲うと react-native-web で高さが
           解決されずカードが描画されない) */}
      <View style={{ flex: 1 }}>
      {/* ===== 検索 (固定・ヘッダー外に置いて focus を保つ) ===== */}
      {items.length > 0 && (
        <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['1'] }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['3'],
              height: 40,
              borderRadius: R.full,
              backgroundColor: C.bg2,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Icon.search size={16} color={C.text3} strokeWidth={2.2} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="保存した投稿を検索"
              placeholderTextColor={C.text3}
              style={[T.body, { color: C.text, flex: 1, paddingVertical: 0 }]}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <PressableScale onPress={() => setSearch('')} haptic="tap" hitSlop={8}>
                <Icon.close size={16} color={C.text3} strokeWidth={2.4} />
              </PressableScale>
            )}
          </View>
        </View>
      )}

      {isLoading ? (
        <View style={{ padding: SP['4'] }}>
          <SkeletonRow kind="list-item" count={6} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ padding: SP['4'] }}>
          <EmptyState
            icon={Icon.save}
            title="まだ保存した投稿はありません"
            message="気になる投稿はブックマークしておけば、コレクションに整理して後でじっくり読めます"
            actionLabel="フィードを見る"
            onAction={() => router.push('/(tabs)/feed' as never)}
            tone="amber"
          />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: SP['4'],
            paddingTop: SP['1'],
            paddingBottom: insets.bottom + SP['10'],
          }}
        >
          {listHeader}
          {filtered.length === 0 ? (
            <View style={{ paddingTop: SP['8'], alignItems: 'center', gap: SP['2'] }}>
              <Icon.search size={28} color={C.text3} strokeWidth={1.8} />
              <Text style={[T.small, { color: C.text3 }]}>
                {search.length > 0 ? '一致する保存投稿がありません' : 'このコレクションは空です'}
              </Text>
            </View>
          ) : (
            filtered.map((p) => (
              <View key={p.id} style={{ marginBottom: SP['2'] }}>
                <SavedCard
                  p={p}
                  onOpen={() => router.push(`/post/${p.id}` as never)}
                  onOrganize={() => setPickerFor(p)}
                />
              </View>
            ))
          )}
        </ScrollView>
      )}
      </View>

      {/* ===== コレクション移動 / 保存解除 ピッカー ===== */}
      <CollectionPickerModal
        target={pickerFor}
        collections={collections}
        busy={moveMut.isPending || unsaveMut.isPending || createCollection.isPending}
        onClose={() => setPickerFor(null)}
        onMove={(collectionId) => {
          if (!pickerFor) return;
          moveMut.mutate({ postId: pickerFor.id, collectionId });
          setPickerFor(null);
        }}
        onUnsave={() => {
          if (!pickerFor) return;
          unsaveMut.mutate(pickerFor.id);
          setPickerFor(null);
        }}
        onCreate={async (name) => {
          const created = await createCollection.mutateAsync({ name });
          if (created && pickerFor) {
            moveMut.mutate({ postId: pickerFor.id, collectionId: created.id });
          }
          setPickerFor(null);
        }}
      />
    </View>
  );
}

// ============================================================
// SavedCard — メディアサムネ付きの保存カード
// ============================================================
function SavedCard({
  p,
  onOpen,
  onOrganize,
}: {
  p: SavedItem;
  onOpen: () => void;
  onOrganize: () => void;
}) {
  const firstMedia = p.media_urls?.[0] ?? null;
  const firstVideo = p.video_urls?.[0] ?? null;
  const isVideo = !!firstVideo || (!!firstMedia && VIDEO_EXT_RE.test(firstMedia));
  const thumb = firstMedia ?? null;

  return (
    <PressableScale
      onPress={onOpen}
      haptic="tap"
      style={{
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
        flexDirection: 'row',
      }}
    >
      <View style={{ flex: 1, gap: SP['2'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <Avatar size={20} anonymous />
          <Text style={[T.caption, { color: C.accent }]}>
            {p.tag_names[0] ? `#${p.tag_names[0]}` : '#雑談'}
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>· {formatRelative(p.created_at)}</Text>
        </View>
        <Text style={[T.body, { color: C.text }]} numberOfLines={3}>
          {p.content}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
          <Text style={[T.caption, { color: C.text3 }]}>♥ {p.likes_count}</Text>
          <Text style={[T.caption, { color: C.text3 }]}>💬 {p.comments_count}</Text>
          <View style={{ flex: 1 }} />
          <PressableScale
            onPress={onOrganize}
            haptic="tap"
            hitSlop={8}
            accessibilityLabel="コレクションに整理"
            style={{
              width: 30,
              height: 30,
              borderRadius: R.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: C.bg3,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Icon.more size={15} color={C.text2} strokeWidth={2.2} />
          </PressableScale>
          <ObsidianSaveButton note={postToObsidianNote(p as never)} size={16} />
        </View>
      </View>

      {/* メディアサムネ */}
      {thumb ? (
        <View style={{ width: 76, height: 76, borderRadius: R.md, overflow: 'hidden', backgroundColor: C.bg3 }}>
          <ExpoImage
            source={{ uri: thumbedUrl(thumb, 160) }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
          />
          {isVideo && (
            <View
              style={{
                position: 'absolute',
                right: 4,
                bottom: 4,
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: 'rgba(0,0,0,0.55)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.play size={12} color="#fff" strokeWidth={2.4} />
            </View>
          )}
        </View>
      ) : null}
    </PressableScale>
  );
}

// ============================================================
// CollectionPickerModal — 投稿をコレクションに移動 / 未分類へ / 保存解除 / 新規作成
// ============================================================
function CollectionPickerModal({
  target,
  collections,
  busy,
  onClose,
  onMove,
  onUnsave,
  onCreate,
}: {
  target: SavedItem | null;
  collections: Array<{ id: string; name: string; emoji: string; bookmark_count: number }>;
  busy: boolean;
  onClose: () => void;
  onMove: (collectionId: string | null) => void;
  onUnsave: () => void;
  onCreate: (name: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const current = target?.collection_id ?? null;

  const reset = () => {
    setCreating(false);
    setName('');
  };

  return (
    <Modal
      visible={target !== null}
      transparent
      animationType="slide"
      onRequestClose={() => {
        reset();
        onClose();
      }}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' }}
        onPress={() => {
          reset();
          onClose();
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            {
              backgroundColor: C.bg2,
              borderTopLeftRadius: R.xl,
              borderTopRightRadius: R.xl,
              paddingHorizontal: SP['4'],
              paddingTop: SP['3'],
              paddingBottom: SP['8'],
              gap: SP['1'],
              borderWidth: 1,
              borderColor: C.border,
            },
            SHADOW.card,
          ]}
        >
          {/* grabber */}
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: C.border2,
              marginBottom: SP['2'],
            }}
          />
          <Text style={[T.bodyB, { color: C.text, paddingBottom: SP['2'] }]}>コレクションに整理</Text>

          {/* 未分類 */}
          <PickerRow
            emoji="📄"
            label="未分類"
            selected={current === null}
            disabled={busy}
            onPress={() => onMove(null)}
          />
          {/* 各コレクション */}
          {collections.map((c) => (
            <PickerRow
              key={c.id}
              emoji={c.emoji}
              label={c.name}
              selected={current === c.id}
              disabled={busy}
              onPress={() => onMove(c.id)}
            />
          ))}

          {/* 新規作成 */}
          {creating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], paddingVertical: SP['2'] }}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="新しいコレクション名"
                placeholderTextColor={C.text3}
                autoFocus
                maxLength={40}
                style={[
                  T.body,
                  {
                    flex: 1,
                    color: C.text,
                    backgroundColor: C.bg3,
                    borderRadius: R.md,
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['2'],
                    borderWidth: 1,
                    borderColor: C.border,
                  },
                ]}
              />
              <PressableScale
                onPress={() => {
                  const n = name.trim();
                  if (n.length === 0 || busy) return;
                  onCreate(n);
                  reset();
                }}
                haptic="confirm"
                disabled={name.trim().length === 0 || busy}
                style={{
                  paddingHorizontal: SP['4'],
                  paddingVertical: SP['2'] + 2,
                  borderRadius: R.md,
                  backgroundColor: C.accent,
                  opacity: name.trim().length === 0 || busy ? 0.5 : 1,
                }}
              >
                <Text style={[T.smallB, { color: '#fff' }]}>作成</Text>
              </PressableScale>
            </View>
          ) : (
            <PressableScale
              onPress={() => setCreating(true)}
              haptic="tap"
              disabled={busy}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['3'],
                paddingVertical: SP['3'],
                paddingHorizontal: SP['2'],
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: R.full,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: C.accentBg,
                  borderWidth: 1,
                  borderColor: C.accent + '55',
                }}
              >
                <Icon.plus size={16} color={C.accent} strokeWidth={2.6} />
              </View>
              <Text style={[T.body, { color: C.accent, fontWeight: '700' }]}>新しいコレクションを作成</Text>
            </PressableScale>
          )}

          {/* 区切り + 保存解除 */}
          <View style={{ height: 1, backgroundColor: C.divider, marginVertical: SP['1'] }} />
          <PressableScale
            onPress={onUnsave}
            haptic="warn"
            disabled={busy}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
              paddingVertical: SP['3'],
              paddingHorizontal: SP['2'],
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: R.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: C.redBg,
              }}
            >
              <Icon.trash size={15} color={C.red} strokeWidth={2.2} />
            </View>
            <Text style={[T.body, { color: C.red, fontWeight: '600' }]}>保存を解除</Text>
          </PressableScale>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PickerRow({
  emoji,
  label,
  selected,
  disabled,
  onPress,
}: {
  emoji: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      disabled={disabled}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingVertical: SP['3'],
        paddingHorizontal: SP['2'],
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
      <Text style={[T.body, { color: C.text, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
      {selected && <Icon.check size={18} color={C.accent} strokeWidth={2.6} />}
    </PressableScale>
  );
}
