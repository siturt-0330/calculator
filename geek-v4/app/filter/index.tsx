// =============================================================================
// app/filter/index.tsx — 「好きなタグ」管理画面
// -----------------------------------------------------------------------------
// フィードで「選択した # のみ」を押したとき (likedTags 空) に開く画面。
// 旧版は「ブロックするタグ」セクションで 158 個のデフォルト有害タグ
// (詐欺 / 自殺 / 性暴力 / 虐待 / 等) を赤い pill で一覧表示していたが、
// ユーザー要望によりブロックリストの画面表示を全廃 (2026-05-31)。
//
//   - ブロック機能自体は内部で動作し続ける (検索/フィード側でフィルタ)。
//   - 個別のブロックタグ編集が必要なら settings/blocked-tags から行う。
//   - この画面では「好きなタグ」追加 / 削除 / 提案だけを扱う。
// =============================================================================
import { View, Text, ScrollView } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTagFilterStore } from '../../stores/tagFilterStore';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useTagGraphStore } from '../../stores/tagGraphStore';
import { useToastStore } from '../../stores/toastStore';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { TagPill } from '../../components/tag/TagPill';
import { Input } from '../../components/ui/Input';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { PressableScale } from '../../components/ui/PressableScale';
import { TagInputSuggestions } from '../../components/tag/TagInputSuggestions';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { buildTagSuggestions, REASON_LABEL } from '../../lib/utils/tagSuggest';
import { useTagRecommendations } from '../../hooks/useTagRecommendations';

export default function FilterScreen() {
  const [likedInput, setLikedInput] = useState('');
  const [showReset, setShowReset] = useState(false);
  // 個別 selector で subscribe — graph nodes や toast の更新で全体 re-render しない
  const likedTags = useTagFilterStore((s) => s.likedTags);
  // blockedTags は handleAddLiked の「既にブロックなら案内 toast」だけで使う (UI 露出なし)
  const blockedTags = useTagFilterStore((s) => s.blockedTags);
  const addLiked = useTagFilterStore((s) => s.addLiked);
  const removeLiked = useTagFilterStore((s) => s.removeLiked);
  const nodes = useTagGraphStore((s) => s.nodes);
  const rootIds = useTagGraphStore((s) => s.rootIds);
  const hydrateGraph = useTagGraphStore((s) => s.hydrate);
  const show = useToastStore((s) => s.show);
  const insets = useSafeAreaInsets();
  const Hash = Icon.hash;

  useEffect(() => {
    void hydrateGraph();
  }, [hydrateGraph]);

  // V4 エンジン: PMI 埋め込み + グラフ + 共起 + CTR + トレンド 統合レコメンド
  const likedRecommendations = useTagRecommendations(likedTags, [...likedTags, ...blockedTags], 20);

  // 旧 graph-only サジェストも fallback として保持 (タグツリーが疎な時のため)
  const graphSuggestions = useMemo(
    () => buildTagSuggestions(likedTags, nodes, rootIds, 20),
    [likedTags, nodes, rootIds],
  );
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

  const hasResettable = likedTags.length > 0;
  const doReset = () => {
    for (const t of [...likedTags]) removeLiked(t);
    setShowReset(false);
    show('好きなタグをリセットしました', 'success');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="好きなタグ"
        left={<BackButton />}
        right={
          hasResettable ? (
            <PressableScale
              onPress={() => setShowReset(true)}
              haptic="tap"
              hitSlop={10}
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                backgroundColor: C.bg3,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>リセット</Text>
            </PressableScale>
          ) : null
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title={`好きなタグ${likedTags.length > 0 ? ` · ${likedTags.length}` : ''}`}
        />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
          {/* 空状態のヒント (likedTags が 0 件のとき大きめに案内) */}
          {likedTags.length === 0 ? (
            <View
              style={{
                paddingHorizontal: SP['4'],
                paddingVertical: SP['4'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.divider,
                gap: SP['1'],
              }}
            >
              <Text style={[T.bodyB, { color: C.text }]}>好きなタグを追加してください</Text>
              <Text style={[T.caption, { color: C.text3 }]}>
                追加したタグの投稿だけがフィードに並びます。下の入力欄から自由に追加できます。
              </Text>
            </View>
          ) : null}

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
                // memory DoS 対策: tag 名は 40 文字 cap
                maxLength={40}
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
            onPick={(t) => {
              addLiked(t);
              setLikedInput('');
            }}
            variant="liked"
          />

          {likedTags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {likedTags.map((t) => (
                <TagPill key={t} name={t} state="liked" onPress={() => removeLiked(t)} />
              ))}
            </View>
          ) : null}

          {/* タグツリーからのサジェスト: 候補がある時だけ表示 */}
          {suggestions.length > 0 && (
            <View style={{ marginTop: SP['2'], gap: SP['2'] }}>
              <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5 }]}>おすすめ</Text>
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
                        {meta.icon}
                        {s.via}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={showReset}
        title="好きなタグをリセット"
        message={`好きなタグ ${likedTags.length} 件を削除します。`}
        confirmLabel="リセット"
        onConfirm={doReset}
        onCancel={() => setShowReset(false)}
        destructive
      />
    </View>
  );
}
