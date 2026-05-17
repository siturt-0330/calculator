import { View, Text, ScrollView } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useTagGraphStore } from '@/stores/tagGraphStore';
import { useToastStore } from '@/stores/toastStore';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { TagPill } from '@/components/tag/TagPill';
import { Input } from '@/components/ui/Input';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { PressableScale } from '@/components/ui/PressableScale';
import { TagInputSuggestions } from '@/components/tag/TagInputSuggestions';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { buildTagSuggestions, REASON_LABEL } from '@/lib/utils/tagSuggest';

export default function FilterScreen() {
  const router = useRouter();
  const [likedInput, setLikedInput] = useState('');
  const [blockedInput, setBlockedInput] = useState('');
  const { likedTags, blockedTags, addLiked, removeLiked, addBlocked, removeBlocked } =
    useTagFilterStore();
  const { nodes, rootIds, hydrate: hydrateGraph } = useTagGraphStore();
  const { show } = useToastStore();
  const insets = useSafeAreaInsets();
  const Hash = Icon.hash;

  useEffect(() => { void hydrateGraph(); }, [hydrateGraph]);

  // タグツリーをベースにサジェスト
  const suggestions = useMemo(
    () => buildTagSuggestions(likedTags, nodes, rootIds, 20),
    [likedTags, nodes, rootIds],
  );

  const handleAddLiked = () => {
    const t = likedInput.trim().replace(/^#/, '');
    if (!t) return;
    const wasBlocked = blockedTags.includes(t);
    addLiked(t);
    setLikedInput('');
    if (wasBlocked) {
      show(`「${t}」をブロックから外して好きに移動しました`, 'info');
    }
  };

  const handleAddBlocked = () => {
    const t = blockedInput.trim().replace(/^#/, '');
    if (!t) return;
    const wasLiked = likedTags.includes(t);
    addBlocked(t);
    setBlockedInput('');
    if (wasLiked) {
      show(`「${t}」を好きから外してブロックに移動しました`, 'info');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="フィルター設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ガイド */}
        <View style={{
          margin: SP['4'],
          padding: SP['3'],
          backgroundColor: C.accentBg,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.accentSoft,
        }}>
          <Text style={[T.small, { color: C.accentLight }]}>
            💡 好きとブロックは重複できません。同じタグを両方に登録しようとすると自動で片方が外れます。
          </Text>
        </View>

        <SectionHeader title="好きなタグ" />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: SP['2'] }}>
            <View style={{ flex: 1 }}>
              <Input
                icon={Hash}
                placeholder="例: ポケモン"
                value={likedInput}
                onChangeText={setLikedInput}
                onSubmitEditing={handleAddLiked}
                returnKeyType="done"
                autoCapitalize="none"
              />
            </View>
            <PressableScale
              onPress={handleAddLiked}
              haptic="confirm"
              disabled={!likedInput.trim()}
              style={{
                paddingHorizontal: SP['3'],
                height: 44,
                backgroundColor: likedInput.trim() ? C.accent : C.bg3,
                borderRadius: R.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: likedInput.trim() ? 1 : 0.5,
              }}
            >
              <Icon.plus size={18} color="#fff" strokeWidth={2.6} />
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>追加</Text>
            </PressableScale>
          </View>

          {/* 入力中のリアルタイム類似タグ提案 */}
          <TagInputSuggestions
            input={likedInput}
            excludeTags={[...likedTags, ...blockedTags]}
            onPick={(t) => { addLiked(t); setLikedInput(''); }}
            variant="liked"
          />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {likedTags.map((t) => (
              <TagPill key={t} name={t} state="liked" onPress={() => removeLiked(t)} />
            ))}
            {likedTags.length === 0 && (
              <Text style={[T.small, { color: C.text3 }]}>まだ追加されていません</Text>
            )}
          </View>

          {/* タグツリーからのサジェスト (常時表示) */}
          <View style={{
            marginTop: SP['1'],
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14 }}>💡</Text>
              <Text style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}>
                これもどうですか？
              </Text>
              <PressableScale onPress={() => router.push('/oshi/tag-graph' as never)} haptic="tap">
                <Text style={[T.caption, { color: C.accent }]}>連携を編集</Text>
              </PressableScale>
            </View>
            {suggestions.length === 0 ? (
              <View style={{ paddingVertical: SP['3'], gap: SP['2'] }}>
                <Text style={[T.small, { color: C.text2 }]}>
                  タグ連携を作ると、入力したタグから関連タグを自動提案します。
                </Text>
                <PressableScale
                  onPress={() => router.push('/oshi/tag-graph' as never)}
                  haptic="confirm"
                  style={{
                    alignSelf: 'flex-start',
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['2'],
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.accentSoft,
                  }}
                >
                  <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>
                    🔗 タグ連携を作る
                  </Text>
                </PressableScale>
              </View>
            ) : (
              <>
                <Text style={[T.caption, { color: C.text3 }]}>
                  {likedTags.length === 0
                    ? 'タグツリーから探してみよう'
                    : '入力したタグから関連を分析・提案'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {suggestions.map((s) => {
                    const meta = REASON_LABEL[s.reason];
                    return (
                      <PressableScale
                        key={s.tag}
                        onPress={() => {
                          addLiked(s.tag);
                          show(`「${s.tag}」を好きに追加`, 'success');
                        }}
                        haptic="confirm"
                        style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        paddingHorizontal: SP['3'],
                        paddingVertical: 6,
                        backgroundColor: meta.color + '22',
                        borderRadius: R.full,
                        borderWidth: 1,
                        borderColor: meta.color + '55',
                        borderStyle: 'dashed',
                      }}
                    >
                      <Text style={{ fontSize: 10 }}>＋</Text>
                      <Text style={[T.caption, { color: meta.color, fontWeight: '700' }]}>
                        {s.tag}
                      </Text>
                      <Text style={{ fontSize: 9, color: C.text3 }}>
                        {meta.icon}{s.via}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
              </>
            )}
          </View>
        </View>

        <SectionHeader title="ブロックするタグ" />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: SP['2'] }}>
            <View style={{ flex: 1 }}>
              <Input
                icon={Hash}
                placeholder="例: ネタバレ"
                value={blockedInput}
                onChangeText={setBlockedInput}
                onSubmitEditing={handleAddBlocked}
                returnKeyType="done"
                autoCapitalize="none"
              />
            </View>
            <PressableScale
              onPress={handleAddBlocked}
              haptic="confirm"
              disabled={!blockedInput.trim()}
              style={{
                paddingHorizontal: SP['3'],
                height: 44,
                backgroundColor: blockedInput.trim() ? '#E24B4A' : C.bg3,
                borderRadius: R.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: blockedInput.trim() ? 1 : 0.5,
              }}
            >
              <Icon.plus size={18} color="#fff" strokeWidth={2.6} />
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>追加</Text>
            </PressableScale>
          </View>

          {/* 入力中のリアルタイム類似タグ提案 */}
          <TagInputSuggestions
            input={blockedInput}
            excludeTags={[...likedTags, ...blockedTags]}
            onPick={(t) => { addBlocked(t); setBlockedInput(''); }}
            variant="blocked"
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
