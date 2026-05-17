import { View, Text, ScrollView } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { TagPill } from '@/components/tag/TagPill';
import { Input } from '@/components/ui/Input';
import { PressableScale } from '@/components/ui/PressableScale';
import { TagInputSuggestions } from '@/components/tag/TagInputSuggestions';
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

        {/* 安全のため事前にブロック中のタグの案内 */}
        <View style={{
          padding: SP['3'],
          backgroundColor: 'rgba(226,75,74,0.08)',
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: 'rgba(226,75,74,0.3)',
          gap: SP['1'],
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 14 }}>🛡️</Text>
            <Text style={[T.smallM, { color: '#E24B4A', fontWeight: '700' }]}>
              安全のため、デフォルトで一部のタグをブロック中
            </Text>
          </View>
          <Text style={[T.caption, { color: C.text2, lineHeight: 16 }]}>
            詐欺・マルチ・暴力・自殺・虐待・わいせつ・誹謗中傷・薬物・カルト・誤情報等を含むタグは初期状態でブロックされています。不要なら下の一覧から個別にタップして解除できます。
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: SP['2'] }}>
          <View style={{ flex: 1 }}>
            <Input
              label="除外するタグ"
              icon={Hash}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => add(input)}
              placeholder="例: ネタバレ"
              returnKeyType="done"
            />
          </View>
          <PressableScale
            onPress={() => add(input)}
            haptic="confirm"
            disabled={!input.trim()}
            style={{
              paddingHorizontal: SP['3'],
              height: 44,
              backgroundColor: input.trim() ? '#E24B4A' : C.bg3,
              borderRadius: R.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              opacity: input.trim() ? 1 : 0.5,
            }}
          >
            <Icon.plus size={18} color="#fff" strokeWidth={2.6} />
            <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>追加</Text>
          </PressableScale>
        </View>

        {/* 入力中のリアルタイム類似タグ提案 */}
        <TagInputSuggestions
          input={input}
          excludeTags={blockedTags}
          onPick={(t) => { add(t); }}
          variant="blocked"
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
