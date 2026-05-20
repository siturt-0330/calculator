import { View, Text, ScrollView } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { TagPill } from '../../components/tag/TagPill';
import { Input } from '../../components/ui/Input';
import { PressableScale } from '../../components/ui/PressableScale';
import { TagInputSuggestions } from '../../components/tag/TagInputSuggestions';
import { useTagFilterStore } from '../../stores/tagFilterStore';
import { useTagGraphStore } from '../../stores/tagGraphStore';
import { BackButton } from '../../components/nav/BackButton';
import { Icon } from '../../constants/icons';
import { buildTagSuggestions, REASON_LABEL } from '../../lib/utils/tagSuggest';

const SUGGESTED = ['ポケモン', 'アニメ', '漫画', 'ゲーム', 'コスプレ', 'アイドル', 'VTuber', '声優', '鉄道', 'カメラ'];

export default function LikedTagsScreen() {
  const [input, setInput] = useState('');
  const { likedTags, addLiked, removeLiked } = useTagFilterStore();
  const { nodes, rootIds, hydrate: hydrateGraph } = useTagGraphStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Hash = Icon.hash;

  useEffect(() => { void hydrateGraph(); }, [hydrateGraph]);

  const suggestions = useMemo(
    () => buildTagSuggestions(likedTags, nodes, rootIds, 16),
    [likedTags, nodes, rootIds],
  );

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
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['6'],
          paddingBottom: insets.bottom + SP['20'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <BackButton />
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>好きなタグを選ぼう</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            選んだタグの投稿が優先して表示されます。後から変更できます。
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: SP['2'] }}>
          <View style={{ flex: 1 }}>
            <Input
              label="タグを検索・追加"
              icon={Hash}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => add(input)}
              placeholder="例: ポケモン"
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
              backgroundColor: input.trim() ? C.accent : C.bg3,
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
          excludeTags={likedTags}
          onPick={(t) => { add(t); }}
          variant="liked"
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

        {/* タグツリーから「これもどうですか？」 (常時表示) */}
        <View style={{
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.border,
          gap: SP['2'],
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 14 }}>💡</Text>
            <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
              これもどうですか？
            </Text>
          </View>
          {suggestions.length === 0 ? (
            <Text style={[T.caption, { color: C.text3 }]}>
              タグを入力すると、それを分析して関連タグを提案します。
            </Text>
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
                      onPress={() => add(s.tag)}
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
        {likedTags.length === 0 && (
          <Text style={[T.caption, { color: C.amber, textAlign: 'center', marginBottom: SP['2'] }]}>
            ⚠ タグを選ばない場合、全ジャンルの投稿が表示されます。1 つ以上選ぶと自分専用のフィードになります。
          </Text>
        )}
        <Button
          label={likedTags.length > 0 ? `${likedTags.length}個選択して次へ` : 'スキップして次へ'}
          onPress={() => router.push('/onboarding/blocked-tags')}
        />
      </View>
    </View>
  );
}
