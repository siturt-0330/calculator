// ============================================================
// app/(tabs)/community/[id]/bbs.tsx
// ------------------------------------------------------------
// コミュニティ詳細画面の「掲示板」サブタブ (standalone route 版)。
// /community/[id]/bbs として deep link 可能 — community/[id]/index.tsx
// の内部サブタブ切替からも (router.push で) ここに飛んでくる。
//
// 構成:
//   - 上部 TopBar (BackButton + コミュ名)
//   - "新規スレッド" gradient pill (FAB ではなく大きめの banner として常時表示)
//   - スレッド list (lib/api/bbs.ts の fetchCommunityThreads)
//
// 既存の app/(tabs)/community/[id]/index.tsx 内 ThreadsTab と機能的に等価。
// 既存の app/(tabs)/bbs.tsx (ホーム掲示板) と design 統一感を出す。
// ============================================================
import { View, Text, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { C, R, SP, SHADOW, GRAD } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { TABBAR } from '../../../../design/tabbar';
import { BackButton } from '../../../../components/nav/BackButton';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Spinner } from '../../../../components/ui/Spinner';
import { Icon } from '../../../../constants/icons';
import { CommunitySubTabs } from '../../../../components/community/CommunitySubTabs';
import { useToastStore } from '../../../../stores/toastStore';
import { fetchCommunity } from '../../../../lib/api/communities';
import { fetchCommunityThreads } from '../../../../lib/api/bbs';
import { formatRelative } from '../../../../lib/utils/date';
import type { BBSThread } from '../../../../types/models';

// 既存 index.tsx と同じ category color map を使う (UX 一貫性)
const CATEGORY_COLORS: Record<string, string> = {
  '雑談': '#22D3A4', 'アニメ': '#FF6B7A', 'ゲーム': '#7CB1FF',
  'マンガ': '#F472B6', '音楽': '#FCD34D', 'アイドル': '#FF8C30',
  'Vtuber': '#A78BFA', '推し活': '#EC4899', 'グルメ': '#84CC16',
  'コスプレ': '#06B6D4', 'ニュース': '#94A3B8',
};

export default function CommunityBBSScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { show: showToast } = useToastStore();

  // コミュ名 (header に出す。重複 fetch だが useQuery 同 key で実質キャッシュ共有)
  const { data: community } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 2 * 60_000,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['community', id, 'threads'],
    queryFn: () => fetchCommunityThreads(id, { sort: 'new' }),
    enabled: id.length > 0,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (isError) showToast('スレッドの取得に失敗しました', 'error');
  }, [isError, showToast]);

  const threads: BBSThread[] = data ?? [];

  // サブタブ navigation — 別 sub-tab に飛ぶときは index.tsx に戻して
  // ?subTab=<key> でディスパッチ (index.tsx 側が ハンドル)
  const goSubTab = useCallback(
    (key: 'home' | 'bbs' | 'map' | 'calendar' | 'admin') => {
      if (key === 'bbs') return;
      const dest =
        key === 'home' ? `/community/${id}`
        : key === 'map' ? `/community/${id}/map`
        : key === 'calendar' ? `/community/${id}/calendar`
        : `/community/${id}/admin`;
      router.push(dest as never);
    },
    [router, id],
  );

  const goCreate = useCallback(() => {
    router.push(`/bbs/create?community_id=${encodeURIComponent(id)}` as never);
  }, [router, id]);

  const showAdmin =
    !!community && (community.role === 'owner' || community.role === 'admin');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* TopBar */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <BackButton />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon.bbs size={18} color={C.text} strokeWidth={2.4} />
          <Text style={[T.h3, { color: C.text }]} numberOfLines={1}>
            掲示板
          </Text>
          {community?.name && (
            <Text style={[T.small, { color: C.text3 }]} numberOfLines={1}>
              · {community.name}
            </Text>
          )}
        </View>
      </View>

      {/* Sub-tabs ナビ — current=bbs */}
      <CommunitySubTabs value="bbs" onChange={goSubTab} showAdmin={showAdmin} />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['16'],
          gap: SP['3'],
        }}
      >
        {/* "新規スレッド" gradient pill — 常時表示 */}
        <PressableScale
          onPress={goCreate}
          haptic="confirm"
          scaleValue={0.97}
          accessibilityLabel="新しいスレッドを立てる"
          style={{ borderRadius: R.lg, overflow: 'hidden', ...SHADOW.glow }}
        >
          <LinearGradient
            colors={[GRAD.primary[0], GRAD.primary[GRAD.primary.length - 1]] as unknown as readonly [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
              paddingHorizontal: SP['4'],
              paddingVertical: SP['3'],
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.edit size={18} color="#fff" strokeWidth={2.6} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>
                + 新規スレッド
              </Text>
              <Text style={[T.small, { color: 'rgba(255,255,255,0.85)', marginTop: 2 }]} numberOfLines={1}>
                このコミュニティで新しい話題を始めよう
              </Text>
            </View>
            <Icon.chevronR size={20} color="#fff" strokeWidth={2.4} />
          </LinearGradient>
        </PressableScale>

        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : threads.length === 0 ? (
          <View
            style={{
              paddingHorizontal: SP['4'],
              paddingTop: SP['6'],
              paddingBottom: SP['8'],
              alignItems: 'center',
              gap: SP['3'],
            }}
          >
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: C.accent + '1A',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: C.accent + '33',
              }}
            >
              <Icon.bbs size={48} color={C.accent} strokeWidth={1.8} />
            </View>
            <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
              最初のスレッドを立ててみよう
            </Text>
            <Text style={[T.body, { color: C.text2, textAlign: 'center', lineHeight: 22 }]}>
              気になる話題・質問・雑談、何でも気軽に投稿できます
            </Text>
          </View>
        ) : (
          <FlatList
            scrollEnabled={false}
            data={threads}
            keyExtractor={(t) => t.id}
            ItemSeparatorComponent={() => <View style={{ height: SP['2'] }} />}
            renderItem={({ item: t }) => {
              const catColor = t.category ? (CATEGORY_COLORS[t.category] ?? C.accent) : C.accent;
              return (
                <PressableScale
                  onPress={() => router.push(`/bbs/${t.id}` as never)}
                  haptic="tap"
                  scaleValue={0.99}
                  style={{
                    flexDirection: 'row',
                    borderRadius: R.lg,
                    backgroundColor: C.bg2,
                    borderWidth: 1,
                    borderColor: C.border,
                    overflow: 'hidden',
                  }}
                >
                  <View style={{ width: 4, backgroundColor: catColor }} />
                  <View style={{ flex: 1, padding: SP['3'], gap: SP['2'] }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                      {t.category && (
                        <View
                          style={{
                            paddingHorizontal: SP['2'],
                            paddingVertical: 2,
                            backgroundColor: catColor + '22',
                            borderRadius: R.sm,
                            borderWidth: 1,
                            borderColor: catColor + '55',
                          }}
                        >
                          <Text style={{ color: catColor, fontSize: 10, fontWeight: '700' }}>
                            {t.category}
                          </Text>
                        </View>
                      )}
                      {t.visibility === 'community_only' && (
                        <View
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            backgroundColor: C.amber + '20',
                            borderRadius: R.full,
                            borderWidth: 1,
                            borderColor: C.amber + '60',
                          }}
                        >
                          <Text style={{ color: C.amber, fontSize: 10, fontWeight: '700' }}>
                            限定
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }} />
                      <Text style={[T.caption, { color: C.text3 }]}>
                        {formatRelative(t.last_reply_at ?? t.created_at)}
                      </Text>
                    </View>
                    <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={2}>
                      {t.title}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Icon.comment size={13} color={C.text3} strokeWidth={2.2} />
                        <Text style={[T.small, { color: C.text3, fontWeight: '600' }]}>
                          {t.replies_count.toLocaleString('ja-JP')}
                        </Text>
                      </View>
                    </View>
                  </View>
                </PressableScale>
              );
            }}
          />
        )}

        {/* loading footer (空配列&loading=false の同居を防ぐため明示分岐) */}
        {!isLoading && threads.length > 0 && (
          <View style={{ paddingVertical: SP['2'], alignItems: 'center' }}>
            <Text style={[T.caption, { color: C.text4 }]}>— 以上 {threads.length} 件 —</Text>
          </View>
        )}
      </ScrollView>

      {/* FAB (右下) — Banner と二重露出だが、長い list を下までスクロールしても
          すぐに新規作成できるよう duplicate で配置 */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          right: SP['4'],
          bottom: insets.bottom + TABBAR.height + SP['3'],
        }}
      >
        <PressableScale
          onPress={goCreate}
          haptic="confirm"
          scaleValue={0.92}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: C.accent,
            alignItems: 'center',
            justifyContent: 'center',
            ...SHADOW.accentGlow,
          }}
          accessibilityLabel="新規スレッドを立てる"
        >
          <Icon.edit size={24} color="#fff" strokeWidth={2.6} />
        </PressableScale>
      </View>
    </View>
  );
}

// 未使用警告抑止 — ActivityIndicator は将来 inline 化したい時の保険
// (旧版 ThreadsTab で使われていた)
void ActivityIndicator;
