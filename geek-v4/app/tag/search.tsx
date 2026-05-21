import { useMemo, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useDebounce } from '../../hooks/useDebounce';
import { findClosestK } from '../../lib/search/typoCorrect';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { SearchBar } from '../../components/ui/SearchBar';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { Icon } from '../../constants/icons';
import type { Tag } from '../../types/models';

export default function TagSearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  // 短いクエリは 100ms / 長いクエリは 150ms (体感応答性 up)
  const debouncedQuery = useDebounce(query, query.trim().length <= 2 ? 100 : 150);
  const BackIcon = Icon.arrowL;
  const HashIcon = Icon.hash;

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tag-search', debouncedQuery],
    queryFn: async () => {
      let q = supabase.from('tags').select('id, name, post_count').order('post_count', { ascending: false }).limit(50);
      if (debouncedQuery) {
        q = q.ilike('name', `%${debouncedQuery}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Tag[];
    },
    staleTime: 60_000,
  });

  // 0 件ヒット時のもしかして候補 — 既知タグ名群からタイポ補正
  // ヒットがある時の負担を避けるため、tags が 0 件の時だけ広めに取得
  const { data: allTagNames = [] } = useQuery({
    queryKey: ['all-tag-names-typo'],
    queryFn: async () => {
      const { data } = await supabase
        .from('tags')
        .select('name')
        .order('post_count', { ascending: false })
        .limit(500);
      return ((data ?? []) as { name: string }[]).map((t) => t.name);
    },
    enabled: tags.length === 0 && debouncedQuery.trim().length >= 2,
    staleTime: 5 * 60_000,
  });
  const didYouMean = useMemo(() => {
    if (tags.length > 0 || debouncedQuery.trim().length < 2) return [] as string[];
    return findClosestK(debouncedQuery.trim(), allTagNames, 5, 0.5);
  }, [tags.length, debouncedQuery, allTagNames]);

  const renderTag = ({ item }: { item: Tag }) => (
    <PressableScale
      onPress={() => router.push(`/tag/${item.name}`)}
      haptic="tap"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingHorizontal: SP['4'],
        paddingVertical: SP['4'],
        borderBottomWidth: 1,
        borderBottomColor: C.divider,
      }}
    >
      <HashIcon size={18} color={C.accent} strokeWidth={2.2} />
      <View style={{ flex: 1 }}>
        <Text style={[T.bodyM, { color: C.text }]}>{item.name}</Text>
        <Text style={[T.small, { color: C.text3 }]}>{item.post_count.toLocaleString('ja-JP')} 投稿</Text>
      </View>
    </PressableScale>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['3'],
          paddingHorizontal: SP['4'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <PressableScale onPress={() => router.back()} haptic="tap" style={{ padding: SP['2'] }}>
          <BackIcon size={24} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder="タグを検索..."
            autoFocus
            onSubmit={() => {
              // Enter で確定 — 最上位ヒットが 1 件あれば即遷移
              const top = tags[0];
              if (top) router.push(`/tag/${top.name}`);
            }}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
      ) : (
        <FlatList
          data={tags}
          keyExtractor={(item) => item.id}
          renderItem={renderTag}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <View style={{ padding: SP['12'], alignItems: 'center', gap: SP['3'] }}>
              <Text style={[T.body, { color: C.text3, textAlign: 'center' }]}>
                {debouncedQuery ? `「${debouncedQuery}」に一致するタグがありません` : 'タグがありません'}
              </Text>
              {/* 入力中の文字列がある場合は「そのタグを開く」 — 新規タグページに直接遷移 */}
              {debouncedQuery.trim().length > 0 && didYouMean.length === 0 && (
                <PressableScale
                  onPress={() => router.push(`/tag/${encodeURIComponent(debouncedQuery.trim())}`)}
                  haptic="confirm"
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: SP['4'], paddingVertical: SP['2'],
                    backgroundColor: C.accent,
                    borderRadius: R.full,
                  }}
                >
                  <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
                    #{debouncedQuery.trim()} を開く
                  </Text>
                </PressableScale>
              )}
              {didYouMean.length > 0 && (
                <View style={{ alignItems: 'center', gap: 6 }}>
                  <Text style={[T.small, { color: C.text3 }]}>もしかして:</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                    {didYouMean.map((s) => (
                      <PressableScale
                        key={s}
                        onPress={() => setQuery(s)}
                        haptic="select"
                        style={{
                          paddingHorizontal: SP['3'], paddingVertical: 4,
                          backgroundColor: C.accentBg,
                          borderRadius: R.full,
                          borderWidth: 1, borderColor: C.accentSoft,
                        }}
                      >
                        <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
                          #{s}
                        </Text>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}
