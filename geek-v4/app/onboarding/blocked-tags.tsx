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

export default function BlockedTagsScreen() {
  const [input, setInput] = useState('');
  const { blockedTags, addBlocked, removeBlocked } = useTagFilterStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Hash = Icon.hash;

  const add = (tag: string) => {
    const t = tag.trim().replace(/^#/, '');
    if (!t) return;
    if (blockedTags.includes(t)) removeBlocked(t);
    else addBlocked(t);
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
          <Text style={[T.h1, { color: C.text }]}>見たくないタグを除外しよう</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            このタグを含む投稿はフィードに表示されません。
          </Text>
        </View>

        <Input
          label="除外するタグ"
          icon={Hash}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => add(input)}
          placeholder="例: ネタバレ"
          returnKeyType="done"
        />

        {blockedTags.length > 0 && (
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallM, { color: C.text3 }]}>除外中 ({blockedTags.length})</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {blockedTags.map((t) => (
                <TagPill key={t} name={t} state="blocked" onPress={() => removeBlocked(t)} />
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
          label="次へ"
          onPress={() => router.push('/onboarding/notifications')}
        />
      </View>
    </View>
  );
}
