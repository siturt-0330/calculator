import { View, Text, ScrollView, RefreshControl, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { Input } from '../../../components/ui/Input';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Skeleton, SkeletonCircle } from '../../../components/ui/Skeleton';
import { BackButton } from '../../../components/nav/BackButton';
import { Icon } from '../../../constants/icons';
import { discoverCommunities, type Community } from '../../../lib/api/communities';
import { OfficialBadge } from '../../../components/community/OfficialBadge';
import { TABBAR } from '../../../design/tabbar';

export default function DiscoverCommunitiesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Community[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await discoverCommunities({ query: query.trim() || undefined, limit: 30 });
    setResults(data);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    // 初期ロード — 人気のコミュニティ
    void load();
    // クエリ変更時の debounce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // query が変わってから debounce 後に検索
  // 短いクエリ (≤2 文字) は 100ms — autocomplete を爆速に
  useEffect(() => {
    const q = query.trim();
    const delay = q.length <= 2 ? 100 : 150;
    const t = setTimeout(() => {
      void load();
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
          gap: SP['3'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <BackButton />
          <Text style={[T.h2, { color: C.text, flex: 1 }]}>コミュニティを探す</Text>
          <PressableScale
            onPress={() => router.push('/community/create' as never)}
            haptic="confirm"
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'],
              backgroundColor: C.accent,
              borderRadius: R.full,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon.plus size={14} color="#fff" strokeWidth={2.6} />
            <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>作成</Text>
          </PressableScale>
        </View>
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <Input
            icon={Icon.search}
            value={query}
            onChangeText={setQuery}
            placeholder="名前やテーマで検索"
            returnKeyType="search"
            autoFocus
            keyboardAppearance="dark"
            selectionColor={C.accent}
          />
          {query.length > 0 && (
            <PressableScale
              onPress={() => setQuery('')}
              haptic="tap"
              hitSlop={10}
              style={{
                position: 'absolute',
                right: SP['2'],
                top: 0,
                bottom: 0,
                justifyContent: 'center',
                paddingHorizontal: SP['2'],
              }}
            >
              <Icon.close size={16} color={C.text3} strokeWidth={2.4} />
            </PressableScale>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          gap: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* セクションラベル — クエリ無しの初期表示時のみ "人気急上昇" を表示 */}
        {!query.trim() && results.length > 0 && (
          <Text
            style={[
              T.smallB,
              {
                color: C.text3,
                letterSpacing: 1.2,
                fontWeight: '700',
                marginTop: SP['1'],
                marginBottom: -SP['1'],
              },
            ]}
          >
            人気のコミュニティ
          </Text>
        )}

        {loading && results.length === 0 ? (
          // skeleton 4 枚 — 「探す」画面はカードが視覚的に大きいので 3-5 枚が適量
          Array.from({ length: 4 }).map((_, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                gap: SP['3'],
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                alignItems: 'center',
              }}
            >
              <SkeletonCircle size={52} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="50%" height={14} />
                <Skeleton width="90%" height={12} />
                <Skeleton width="40%" height={10} />
              </View>
            </View>
          ))
        ) : results.length === 0 && !loading ? (
          <View style={{ alignItems: 'center', padding: SP['10'], gap: SP['3'] }}>
            <View style={{
              width: 88, height: 88, borderRadius: 44,
              backgroundColor: C.accentBg,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: C.accentSoft,
            }}>
              <Icon.community size={42} color={C.accent} strokeWidth={1.7} />
            </View>
            <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
              {query.trim() ? '見つかりませんでした' : 'まだコミュニティがありません'}
            </Text>
            <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 300 }]}>
              {query.trim()
                ? `「${query.trim()}」を含むコミュニティが見つかりません。新規作成しませんか？`
                : '最初のコミュニティを作って仲間を募集してみよう'}
            </Text>
            <PressableScale
              onPress={() => router.push('/community/create' as never)}
              haptic="confirm"
              hitSlop={10}
              style={{
                marginTop: SP['2'],
                paddingHorizontal: SP['5'],
                paddingVertical: SP['3'],
                backgroundColor: C.accent,
                borderRadius: R.full,
                flexDirection: 'row', alignItems: 'center', gap: 6,
              }}
            >
              <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
              <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700' }]}>
                {query.trim() ? `「${query.trim()}」を作成` : '最初のコミュニティを作る'}
              </Text>
            </PressableScale>
          </View>
        ) : (
          results.map((c) => (
            <PressableScale
              key={c.id}
              onPress={() => router.push(`/community/${c.id}` as never)}
              haptic="tap"
              scaleValue={0.98}
              style={{
                flexDirection: 'row',
                gap: SP['3'],
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {c.icon_url ? (
                  <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <Text style={{ fontSize: 26 }}>{c.icon_emoji}</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {c.is_official && <OfficialBadge size="sm" />}
                  {c.visibility === 'request' && (
                    <Icon.lock size={12} color={C.amber} strokeWidth={2.4} />
                  )}
                </View>
                {c.description.length > 0 && (
                  <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
                    {c.description}
                  </Text>
                )}
                {/* 統計 pill — メンバー数 / 投稿数 を視覚的に分離 */}
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 3,
                    paddingHorizontal: 8, paddingVertical: 3,
                    backgroundColor: C.bg3, borderRadius: R.full,
                  }}>
                    <Icon.community size={10} color={C.text3} strokeWidth={2.4} />
                    <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
                      {c.member_count.toLocaleString('ja-JP')}
                    </Text>
                  </View>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 3,
                    paddingHorizontal: 8, paddingVertical: 3,
                    backgroundColor: C.bg3, borderRadius: R.full,
                  }}>
                    <Icon.bbs size={10} color={C.text3} strokeWidth={2.4} />
                    <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
                      {c.post_count.toLocaleString('ja-JP')}
                    </Text>
                  </View>
                </View>
              </View>
              <Icon.chevronR size={20} color={C.text3} strokeWidth={2} />
            </PressableScale>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
