import { useState, useMemo, useEffect } from 'react';
import { Modal, View, Text, ScrollView, TextInput, ActivityIndicator, Pressable } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { MEMES, ALL_MEMES } from '../../lib/memes';
import { useUserStamps, useCreateUserStamp } from '../../hooks/useUserStamps';
import { useStampPrefsStore } from '../../stores/stampPrefsStore';
import { useToastStore } from '../../stores/toastStore';
import type { ReactionAgg } from '../../lib/api/reactions';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

// 特別タブの key (定型カテゴリの category 名と衝突しないよう __ prefix)
const TAB_POST = '__post';
const TAB_HISTORY = '__history';
const TAB_MYSTAMPS = '__mystamps';

type Tab = { key: string; label: string };

export function MemeReactionPicker({
  visible,
  onClose,
  onPick,
  picked,
  reactions = [],
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (meme: string) => void;
  // 親から渡される「サーバー側で確定済み」の自分のスタンプ一覧
  picked: string[];
  // この投稿に押された全リアクション (= 「この投稿で他の人が使っている」タブ用)
  reactions?: ReactionAgg[];
}) {
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<string>(TAB_MYSTAMPS);
  const [customText, setCustomText] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  // 長押し対象 (マイスタンプ保存/解除のミニシート)
  const [longPressTarget, setLongPressTarget] = useState<string | null>(null);

  const { stamps: userStamps } = useUserStamps();
  const { mutateAsync: createStamp, isPending: creating } = useCreateUserStamp();
  const show = useToastStore((s) => s.show);
  const [submitting, setSubmitting] = useState(false);

  // ローカルの履歴 / マイスタンプ (selector 購読)
  const history = useStampPrefsStore((s) => s.history);
  const myStamps = useStampPrefsStore((s) => s.myStamps);
  const recordUse = useStampPrefsStore((s) => s.recordUse);
  const saveToMyStamps = useStampPrefsStore((s) => s.saveToMyStamps);
  const removeFromMyStamps = useStampPrefsStore((s) => s.removeFromMyStamps);

  // ★ XOR ベースの楽観 selection (baseline は open 時に固定):
  const [baselinePicked, setBaselinePicked] = useState<Set<string>>(new Set());
  const [localFlips, setLocalFlips] = useState<Set<string>>(new Set());

  // 「この投稿で使われているスタンプ」= reactions を件数降順で
  const reactionStamps = useMemo(
    () => [...reactions].sort((a, b) => b.count - a.count).map((r) => r.meme),
    [reactions],
  );

  // マイスタンプ集合 (⭐ 表示判定用)
  const myStampsSet = useMemo(() => new Set(myStamps), [myStamps]);

  // タブ一覧 (中身があるものだけ先頭に出す → 空タブで開かない)
  const tabs = useMemo<Tab[]>(
    () => [
      ...(reactionStamps.length > 0 ? [{ key: TAB_POST, label: 'この投稿' }] : []),
      ...(history.length > 0 ? [{ key: TAB_HISTORY, label: '履歴' }] : []),
      // マイスタンプは「履歴」と定型カテゴリ(面白い〜)の間に置く
      { key: TAB_MYSTAMPS, label: 'マイスタンプ' },
      ...MEMES.map((c) => ({ key: c.category, label: c.short })),
    ],
    [reactionStamps.length, history.length],
  );

  // open 時に local state をリセット + 初期タブを決定 (この投稿→履歴→面白い の順)
  useEffect(() => {
    setLocalFlips(new Set());
    if (visible) {
      setBaselinePicked(new Set(picked));
      setSearchQuery('');
      setShowCustomInput(false);
      setLongPressTarget(null);
      const initial =
        reactionStamps.length > 0
          ? TAB_POST
          : history.length > 0
            ? TAB_HISTORY
            : (MEMES[0]?.category ?? TAB_MYSTAMPS);
      setActiveTab(initial);
    }
    // baseline / 初期タブは open 遷移時のみ更新したいので deps は visible のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 表示用の選択状態 = baselinePicked XOR localFlips
  const visiblyPicked = useMemo(() => {
    const out = new Set<string>(baselinePicked);
    for (const m of localFlips) {
      if (out.has(m)) out.delete(m);
      else out.add(m);
    }
    return out;
  }, [baselinePicked, localFlips]);

  // 検索結果 (q がある時はタブを無視して全スタンプから一致を出す)
  const q = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return [];
    const pool = [
      ...reactionStamps,
      ...history,
      ...myStamps,
      ...ALL_MEMES,
      ...userStamps.filter((s) => s.is_public).map((s) => s.text),
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of pool) {
      if (!m.toLowerCase().includes(q)) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
      if (out.length >= 60) break;
    }
    return out;
  }, [q, reactionStamps, history, myStamps, userStamps]);

  // アクティブタブの中身
  const tabItems = useMemo(() => {
    if (activeTab === TAB_POST) return reactionStamps;
    if (activeTab === TAB_HISTORY) return history;
    if (activeTab === TAB_MYSTAMPS) return myStamps;
    return MEMES.find((c) => c.category === activeTab)?.items ?? [];
  }, [activeTab, reactionStamps, history, myStamps]);

  const handlePick = (meme: string) => {
    setLocalFlips((prev) => {
      const next = new Set(prev);
      if (next.has(meme)) next.delete(meme);
      else next.add(meme);
      return next;
    });
    recordUse(meme); // 履歴に記録
    onPick(meme); // サーバー送信は親に委譲
  };

  const handleCreate = async () => {
    if (submitting) return;
    const t = customText.trim();
    if (!t) return;
    setSubmitting(true);
    try {
      const stamp = await createStamp({ text: t, isPublic: true });
      const text = stamp?.text ?? t;
      saveToMyStamps(text); // マイスタンプにも即反映
      show(`「${text}」を作成しました`, 'success');
      setCustomText('');
      setShowCustomInput(false);
      setLocalFlips((prev) => new Set(prev).add(text));
      recordUse(text);
      onPick(text);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'スタンプの作成に失敗しました';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSaveLongPress = () => {
    if (!longPressTarget) return;
    if (myStampsSet.has(longPressTarget)) {
      removeFromMyStamps(longPressTarget);
      show('マイスタンプから外しました', 'info');
    } else {
      saveToMyStamps(longPressTarget);
      show('マイスタンプに保存しました', 'success');
    }
    setLongPressTarget(null);
  };

  const showingSearch = q.length > 0;
  const gridItems = showingSearch ? searchResults : tabItems;
  const targetSaved = longPressTarget ? myStampsSet.has(longPressTarget) : false;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View
          style={{
            maxHeight: '85%',
            backgroundColor: C.bg2,
            paddingTop: SP['3'],
            paddingBottom: insets.bottom + SP['3'],
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: C.border,
            gap: SP['3'],
          }}
        >
          {/* ヘッダー */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP['4'] }}>
            <PressableScale
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel="閉じる"
              style={{ padding: SP['2'], marginLeft: -SP['2'] }}
              haptic="tap"
            >
              <Icon.close size={24} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={[T.h4, { color: C.text }]}>テキストスタンプ</Text>
            </View>
            <PressableScale
              onPress={onClose}
              haptic="confirm"
              style={{ paddingHorizontal: SP['3'], paddingVertical: SP['1'], marginRight: -SP['2'] }}
            >
              <Text style={[T.bodyM, { color: C.accent, fontWeight: '700' }]}>完了</Text>
            </PressableScale>
          </View>

          {/* 検索バー */}
          <View style={{ paddingHorizontal: SP['4'] }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                backgroundColor: C.bg3,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: searchQuery ? C.accent : C.border,
                paddingHorizontal: SP['3'],
                paddingVertical: 8,
              }}
            >
              <Icon.search size={15} color={C.text3} strokeWidth={2.2} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="スタンプを検索..."
                placeholderTextColor={C.text3}
                style={{ flex: 1, color: C.text, fontSize: 14, fontFamily: 'NotoSansJP_400Regular' }}
                returnKeyType="search"
                clearButtonMode="while-editing"
                keyboardAppearance="dark"
                maxLength={200}
              />
            </View>
          </View>

          {/* タブバー (検索中は隠す) */}
          {!showingSearch && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingHorizontal: SP['4'] }}
              style={{ flexGrow: 0 }}
            >
              {tabs.map((tab) => {
                const active = tab.key === activeTab;
                return (
                  <PressableScale
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    haptic="tap"
                    scaleValue={0.95}
                    style={{
                      paddingHorizontal: SP['3'],
                      paddingVertical: 7,
                      borderRadius: R.full,
                      backgroundColor: active ? C.accent : 'transparent',
                      borderWidth: 1,
                      borderColor: active ? C.accent : C.border,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '700',
                        color: active ? '#fff' : C.text2,
                      }}
                    >
                      {tab.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          )}

          {/* 本体 */}
          <ScrollView contentContainerStyle={{ paddingHorizontal: SP['4'], paddingBottom: SP['4'], gap: SP['3'] }}>
            {/* マイスタンプ: 作成導線 */}
            {!showingSearch && activeTab === TAB_MYSTAMPS && (
              showCustomInput ? (
                <Animated.View
                  entering={FadeIn.duration(160)}
                  style={{
                    gap: SP['2'],
                    padding: SP['3'],
                    backgroundColor: C.bg3,
                    borderRadius: R.lg,
                    borderWidth: 1,
                    borderColor: C.accent,
                  }}
                >
                  <Text style={[T.smallM, { color: C.accent }]}>あたらしいスタンプを作る</Text>
                  <TextInput
                    value={customText}
                    onChangeText={setCustomText}
                    placeholder="例: それは芸術点高い"
                    placeholderTextColor={C.text3}
                    maxLength={40}
                    autoFocus
                    keyboardAppearance="dark"
                    style={{
                      color: C.text,
                      fontSize: 14,
                      fontFamily: 'NotoSansJP_400Regular',
                      backgroundColor: C.bg,
                      borderRadius: R.md,
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['2'],
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                    onSubmitEditing={handleCreate}
                    returnKeyType="send"
                  />
                  <View style={{ flexDirection: 'row', gap: SP['2'] }}>
                    <PressableScale
                      onPress={() => {
                        setShowCustomInput(false);
                        setCustomText('');
                      }}
                      haptic="tap"
                      style={{
                        flex: 1,
                        paddingVertical: SP['2'],
                        backgroundColor: C.bg,
                        borderRadius: R.md,
                        borderWidth: 1,
                        borderColor: C.border,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={[T.smallM, { color: C.text2 }]}>キャンセル</Text>
                    </PressableScale>
                    <PressableScale
                      onPress={handleCreate}
                      disabled={!customText.trim() || creating || submitting}
                      haptic="confirm"
                      hitSlop={8}
                      accessibilityLabel="スタンプを作成して送る"
                      style={{
                        flex: 2,
                        paddingVertical: SP['2'],
                        backgroundColor: customText.trim() && !creating && !submitting ? C.accent : C.bg4,
                        borderRadius: R.md,
                        alignItems: 'center',
                        opacity: !customText.trim() || creating || submitting ? 0.7 : 1,
                      }}
                    >
                      {creating || submitting ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>作って送る</Text>
                      )}
                    </PressableScale>
                  </View>
                </Animated.View>
              ) : (
                <PressableScale
                  onPress={() => setShowCustomInput(true)}
                  haptic="tap"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SP['2'],
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['3'],
                    backgroundColor: C.bg3,
                    borderRadius: R.lg,
                    borderWidth: 1,
                    borderColor: C.border,
                    borderStyle: 'dashed',
                  }}
                >
                  <Icon.plus size={16} color={C.accent} strokeWidth={2.4} />
                  <Text style={[T.smallM, { color: C.accent }]}>自分のスタンプを作る (40文字まで)</Text>
                </PressableScale>
              )
            )}

            {/* グリッド or 空状態 */}
            {gridItems.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {gridItems.map((m) => {
                  const isPicked = visiblyPicked.has(m);
                  return (
                    <PressableScale
                      key={m}
                      onPress={() => handlePick(m)}
                      onLongPress={() => setLongPressTarget(m)}
                      haptic="select"
                      style={{
                        paddingHorizontal: SP['3'],
                        paddingVertical: 8,
                        backgroundColor: isPicked ? C.accent : C.bg3,
                        borderRadius: R.full,
                        borderWidth: 1.5,
                        borderColor: isPicked ? C.accent : C.border,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          color: isPicked ? '#fff' : C.text,
                          fontWeight: '700',
                        }}
                      >
                        {isPicked ? '✓ ' : ''}
                        {m}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: SP['6'], gap: SP['2'] }}>
                {showingSearch ? (
                  <Icon.search size={28} color={C.text3} strokeWidth={2} />
                ) : (
                  <Icon.sparkles size={28} color={C.text3} strokeWidth={2} />
                )}
                <Text style={[T.smallM, { color: C.text3, textAlign: 'center' }]}>
                  {showingSearch
                    ? `「${searchQuery}」に一致するスタンプがありません`
                    : activeTab === TAB_MYSTAMPS
                      ? '保存したスタンプはまだありません。\nスタンプを長押しで「マイスタンプに保存」できます。'
                      : activeTab === TAB_HISTORY
                        ? 'まだ使ったスタンプがありません'
                        : 'まだ誰もスタンプを押していません'}
                </Text>
              </View>
            )}

            {/* ヒント */}
            {!showingSearch && gridItems.length > 0 && (
              <Text style={[T.caption, { color: C.text3, textAlign: 'center', marginTop: SP['1'] }]}>
                タップで送信・長押しでマイスタンプに保存
              </Text>
            )}
          </ScrollView>
        </View>
      </View>

      {/* 長押し: マイスタンプ保存/解除のミニシート */}
      {longPressTarget !== null && (
        <Pressable
          onPress={() => setLongPressTarget(null)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: C.bg2,
              paddingTop: SP['4'],
              paddingHorizontal: SP['4'],
              paddingBottom: insets.bottom + SP['4'],
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTopWidth: 1,
              borderColor: C.border,
              gap: SP['3'],
            }}
          >
            <View style={{ alignItems: 'center', gap: SP['1'] }}>
              <Text style={{ fontSize: 13, color: C.text3 }}>選択中のスタンプ</Text>
              <Text style={[T.h4, { color: C.text }]}>{longPressTarget}</Text>
            </View>
            <PressableScale
              onPress={toggleSaveLongPress}
              haptic="confirm"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: SP['2'],
                paddingVertical: SP['3'],
                backgroundColor: targetSaved ? C.bg3 : C.accent,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: targetSaved ? C.border : C.accent,
              }}
            >
              <Text style={[T.bodyM, { color: targetSaved ? C.text : '#fff', fontWeight: '700' }]}>
                {targetSaved ? 'マイスタンプから外す' : 'マイスタンプに保存する'}
              </Text>
            </PressableScale>
            <PressableScale
              onPress={() => setLongPressTarget(null)}
              haptic="tap"
              style={{ paddingVertical: SP['2'], alignItems: 'center' }}
            >
              <Text style={[T.bodyM, { color: C.text2 }]}>閉じる</Text>
            </PressableScale>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}
