import { View, Text, ScrollView } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { TagPill } from '@/components/tag/TagPill';
import { Input } from '@/components/ui/Input';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { Icon } from '@/constants/icons';

const SUGGESTED = ['ポケモン', 'アニメ', '漫画', 'ゲーム', 'コスプレ', 'アイドル', 'VTuber', '声優', '鉄道', 'カメラ'];

export default function LikedTagsScreen() {
  const [input, setInput] = useState('');
  const { likedTags, addLiked, removeLiked } = useTagFilterStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Hash = Icon.hash;

  const add = (tag: string) => {
    const t = tag.trim().replace(/^#/, '');
    if (!t) return;
    if (likedTags.includes(t)) removeLiked(t);
    else addLiked(t);
    setInput('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + SP['8'],
          paddingHorizontal: SP['6'],
          paddingBottom: insets.bottom + SP['20'],
          gap: SP['6'],
        }}
      >
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>好きなタグを選ぼう</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            選んだタグの投稿が優先して表示されます。後から変更できます。
          </Text>
        </View>

        <Input
          label="タグを検索・追加"
          icon={Hash}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => add(input)}
          placeholder="例: ポケモン"
          returnKeyType="done"
        />

        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text3 }]}>おすすめ</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {SUGGESTED.map((t) => (
              <TagPill
                key={t}
                name={t}
                state={likedTags.includes(t) ? 'liked' : 'normal'}
                onPress={() => add(t)}
              />
            ))}
          </View>
        </View>

        {likedTags.length > 0 && (
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallM, { color: C.text3 }]}>選択中 ({likedTags.length})</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {likedTags.map((t) => (
                <TagPill
                  key={t}
                  name={t}
                  state="liked"
                  onPress={() => removeLiked(t)}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + SP['4'],
          left: SP['6'],
          right: SP['6'],
        }}
      >
        <Button
          label={likedTags.length > 0 ? `${likedTags.length}個選択して次へ` : 'スキップ'}
          onPress={() => router.push('/onboarding/blocked-tags')}
        />
      </View>
    </View>
  );
}
