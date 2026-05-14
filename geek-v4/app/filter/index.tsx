import { View, Text, ScrollView } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { TagPill } from '@/components/tag/TagPill';
import { Input } from '@/components/ui/Input';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Icon } from '@/constants/icons';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';

export default function FilterScreen() {
  const [likedInput, setLikedInput] = useState('');
  const [blockedInput, setBlockedInput] = useState('');
  const { likedTags, blockedTags, addLiked, removeLiked, addBlocked, removeBlocked } =
    useTagFilterStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Hash = Icon.hash;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="フィルター設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
      >
        <SectionHeader title="好きなタグ" />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
          <Input
            icon={Hash}
            placeholder="タグを追加"
            value={likedInput}
            onChangeText={setLikedInput}
            onSubmitEditing={() => {
              const t = likedInput.trim().replace(/^#/, '');
              if (t) { addLiked(t); setLikedInput(''); }
            }}
            returnKeyType="done"
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {likedTags.map((t) => (
              <TagPill key={t} name={t} state="liked" onPress={() => removeLiked(t)} />
            ))}
            {likedTags.length === 0 && (
              <Text style={[T.small, { color: C.text3 }]}>まだ追加されていません</Text>
            )}
          </View>
        </View>

        <SectionHeader title="ブロックするタグ" />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
          <Input
            icon={Hash}
            placeholder="タグを追加"
            value={blockedInput}
            onChangeText={setBlockedInput}
            onSubmitEditing={() => {
              const t = blockedInput.trim().replace(/^#/, '');
              if (t) { addBlocked(t); setBlockedInput(''); }
            }}
            returnKeyType="done"
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {blockedTags.map((t) => (
              <TagPill key={t} name={t} state="blocked" onPress={() => removeBlocked(t)} />
            ))}
            {blockedTags.length === 0 && (
              <Text style={[T.small, { color: C.text3 }]}>まだ追加されていません</Text>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
