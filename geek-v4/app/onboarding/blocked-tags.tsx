import { View, Text, ScrollView } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
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
import { useTagGraphStore } from '@/stores/tagGraphStore';
import { buildTagSuggestions, REASON_LABEL } from '@/lib/utils/tagSuggest';
import { useToastStore } from '@/stores/toastStore';
import { Icon } from '@/constants/icons';

export default function BlockedTagsScreen() {
  const [input, setInput] = useState('');
  const { likedTags, blockedTags, addBlocked, removeBlocked } = useTagFilterStore();
  const { nodes, rootIds, hydrate: hydrateGraph } = useTagGraphStore();
  const { show } = useToastStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Hash = Icon.hash;

  useEffect(() => { void hydrateGraph(); }, [hydrateGraph]);

  const blockSuggestions = useMemo(() => {
    const raw = buildTagSuggestions(blockedTags, nodes, rootIds, 24);
    return raw.filter(
      (s) => !likedTags.includes(s.tag) && !blockedTags.includes(s.tag),
    );
  }, [blockedTags, likedTags, nodes, rootIds]);

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

        {/* 関連タグの提案 (タグ連携をベース) */}
        {blockSuggestions.length > 0 && (
          <View style={{
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14 }}>🛡️</Text>
              <Text style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}>
                これもブロックしますか？
              </Text>
            </View>
            <Text style={[T.caption, { color: C.text3 }]}>
              ブロック中のタグから検索エンジンが関連を提案 ({blockSuggestions.length}件)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {blockSuggestions.map((s) => {
                const meta = REASON_LABEL[s.reason];
                return (
                  <PressableScale
                    key={s.tag}
                    onPress={() => {
                      addBlocked(s.tag);
                      show(`「${s.tag}」をブロックに追加`, 'success');
                    }}
                    haptic="confirm"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: SP['3'],
                      paddingVertical: 6,
                      backgroundColor: 'rgba(226,75,74,0.13)',
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: 'rgba(226,75,74,0.4)',
                    }}
                  >
                    <Text style={{ fontSize: 11 }}>{meta.icon}</Text>
                    <Text style={[T.smallM, { color: '#E24B4A', fontWeight: '700' }]}>
                      {s.tag}
                    </Text>
                  </PressableScale>
                );
              })}
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
