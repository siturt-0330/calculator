import { useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useDebounce } from '@/hooks/useDebounce';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { SearchBar } from '@/components/ui/SearchBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Spinner } from '@/components/ui/Spinner';
import { Icon } from '@/constants/icons';
import type { Tag } from '@/types/models';

export default function TagSearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
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
        <Text style={[T.small, { color: C.text3 }]}>{item.post_count} 投稿</Text>
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
          ListEmptyComponent={
            <View style={{ padding: SP['12'], alignItems: 'center' }}>
              <Text style={[T.body, { color: C.text3 }]}>
                {debouncedQuery ? `「${debouncedQuery}」に一致するタグがありません` : 'タグがありません'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
