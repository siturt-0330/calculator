import { View, Text, ScrollView } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTagFilterStore, DEFAULT_BLOCKED_TAGS } from '@/stores/tagFilterStore';
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
import { useTagRecommendations } from '@/hooks/useTagRecommendations';

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

  // V4 エンジン: PMI 埋め込み + グラフ + 共起 + CTR + トレンド 統合レコメンド
  const likedRecommendations = useTagRecommendations(likedTags, [...likedTags, ...blockedTags], 20);
  const blockedRecommendations = useTagRecommendations(blockedTags, [...likedTags, ...blockedTags], 30);

  // 旧 graph-only サジェストも fallback として保持 (タグツリーが疎な時のため)
  const graphSuggestions = useMemo(
    () => buildTagSuggestions(likedTags, nodes, rootIds, 20),
    [likedTags, nodes, rootIds],
  );
  // V4 レコメンドに変換して filter screen の表示形式に合わせる
  const suggestions = useMemo(() => {
    if (likedRecommendations.length > 0) {
      return likedRecommendations.map((r) => ({
        tag: r.tag,
        reason: 'related' as const,
        via: r.primaryReason,
      }));
    }
    return graphSuggestions;
  }, [likedRecommendations, graphSuggestions]);

  const blockSuggestions = useMemo(() => {
    if (blockedRecommendations.length > 0) {
      return blockedRecommendations.map((r) => ({
        tag: r.tag,
        reason: 'related' as const,
        via: r.primaryReason,
      }));
    }
    return buildTagSuggestions(blockedTags, nodes, rootIds, 30).filter(
      (s) => !likedTags.includes(s.tag) && !blockedTags.includes(s.tag),
    );
  }, [blockedRecommendations, blockedTags, likedTags, nodes, rootIds]);

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
          {/* 安全のため事前にブロック中のタグの案内 */}
          <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5 }]}>
            有害カテゴリを自動ブロック中
          </Text>

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

          {/* ユーザーが追加したカスタムブロック */}
          {(() => {
            const defaultSet = new Set(DEFAULT_BLOCKED_TAGS);
            const customBlocked = blockedTags.filter((t) => !defaultSet.has(t));
            return customBlocked.length > 0 ? (
              <View style={{ gap: SP['2'] }}>
                <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
                  あなたが追加 ({customBlocked.length})
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                  {customBlocked.map((t) => (
                    <TagPill key={t} name={t} state="blocked" onPress={() => removeBlocked(t)} />
                  ))}
                </View>
              </View>
            ) : null;
          })()}

          {/* デフォルト安全タグ (全71個常時表示、トグル可能) */}
          <View style={{ gap: SP['2'], marginTop: SP['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 12 }}>🛡️</Text>
              <Text style={[T.caption, { color: C.text2, fontWeight: '700', flex: 1 }]}>
                安全のためデフォルトでブロック ({blockedTags.filter((t) => DEFAULT_BLOCKED_TAGS.includes(t)).length}/{DEFAULT_BLOCKED_TAGS.length})
              </Text>
            </View>
            <Text style={[T.caption, { color: C.text3 }]}>
              赤=ブロック中 / グレー=解除済み。タップで切り替え
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {DEFAULT_BLOCKED_TAGS.map((t) => {
                const active = blockedTags.includes(t);
                return active ? (
                  <TagPill key={t} name={t} state="blocked" onPress={() => removeBlocked(t)} />
                ) : (
                  <PressableScale
                    key={t}
                    onPress={() => addBlocked(t)}
                    haptic="select"
                    style={{
                      paddingHorizontal: SP['3'],
                      paddingVertical: 4,
                      borderRadius: R.full,
                      backgroundColor: 'transparent',
                      borderWidth: 1,
                      borderColor: C.border,
                      opacity: 0.5,
                    }}
                  >
                    <Text style={[T.small, { color: C.text3 }]}>
                      #{t}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          {/* タグ連携からの関連ブロック候補 */}
          <View style={{
            marginTop: SP['3'],
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
              <PressableScale onPress={() => router.push('/oshi/tag-graph' as never)} haptic="tap">
                <Text style={[T.caption, { color: C.accent }]}>連携を編集</Text>
              </PressableScale>
            </View>

            {blockSuggestions.length === 0 ? (
              <Text style={[T.small, { color: C.text2 }]}>
                {blockedTags.length === 0
                  ? 'ブロック中のタグから自動的に関連タグを提案します。まずは1つブロックしてみてください。'
                  : '今のブロックタグに関連する候補はありません。'}
              </Text>
            ) : (
              <>
                <Text style={[T.caption, { color: C.text3 }]}>
                  ブロック中のタグから検索エンジンが関連を分析・提案 ({blockSuggestions.length}件)
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
                        <Text style={{ fontSize: 9, color: C.text3, marginLeft: 2 }}>
                          {meta.label}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
                {blockSuggestions.length > 0 && (
                  <PressableScale
                    onPress={() => {
                      let count = 0;
                      for (const s of blockSuggestions) {
                        if (!blockedTags.includes(s.tag) && !likedTags.includes(s.tag)) {
                          addBlocked(s.tag);
                          count++;
                        }
                      }
                      if (count > 0) show(`${count}件のタグを一括ブロック`, 'success');
                    }}
                    haptic="confirm"
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: SP['1'],
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['1'],
                      backgroundColor: 'rgba(226,75,74,0.20)',
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: 'rgba(226,75,74,0.5)',
                    }}
                  >
                    <Text style={[T.caption, { color: '#E24B4A', fontWeight: '700' }]}>
                      🛡️ 上記をまとめてブロック
                    </Text>
                  </PressableScale>
                )}
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
