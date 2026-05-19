import { View, Text, ScrollView, RefreshControl, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Input } from '@/components/ui/Input';
import { PressableScale } from '@/components/ui/PressableScale';
import { BackButton } from '@/components/nav/BackButton';
import { Icon } from '@/constants/icons';
import { discoverCommunities, type Community } from '@/lib/api/communities';

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

  // query が変わってから 350ms 後に検索
  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 350);
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
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          gap: SP['3'],
          paddingBottom: insets.bottom + SP['10'],
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {results.length === 0 && !loading ? (
          <View style={{ alignItems: 'center', padding: SP['10'], gap: SP['3'] }}>
            <Icon.community size={48} color={C.text3} strokeWidth={1.6} />
            <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
              {query.trim()
                ? '一致するコミュニティが見つかりません'
                : 'まだ公開コミュニティがありません'}
            </Text>
            <PressableScale
              onPress={() => router.push('/community/create' as never)}
              haptic="confirm"
              style={{
                marginTop: SP['2'],
                paddingHorizontal: SP['5'],
                paddingVertical: SP['3'],
                backgroundColor: C.accent,
                borderRadius: R.md,
              }}
            >
              <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700' }]}>
                最初のコミュニティを作る
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {c.visibility === 'request' && (
                    <Icon.lock size={12} color={C.amber} strokeWidth={2.4} />
                  )}
                </View>
                {c.description.length > 0 && (
                  <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
                    {c.description}
                  </Text>
                )}
                <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>
                  メンバー {c.member_count} 人 · 投稿 {c.post_count} 件
                </Text>
              </View>
              <Icon.chevronR size={20} color={C.text3} strokeWidth={2} />
            </PressableScale>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
