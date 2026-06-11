// ============================================================
// MemeReactionPicker — テキストスタンプ送信シート
// ------------------------------------------------------------
// LINE / Slack のスタンプピッカーに寄せた「送って気持ちいい」設計:
//   - タップ = 即送信。confirm haptic + chip の scale pop (worklet/transform のみ)
//     → ~180ms 後に自動クローズして「送った感」を出す。
//     既に押してあるスタンプのタップ = 取り消しで、こちらは閉じない
//     (誤送リカバリの動線なので「送った」演出を付けない)。
//   - 長押し = マイスタンプ保存/解除のミニシート (既存挙動を維持)。
//     保存済みスタンプには小さな ★ を付けて視覚フィードバック。
//   - カテゴリ chips は選択中のみ GRAD.primary の gradient pill + 白文字。
//   - スタンプ chips は FadeInDown の stagger で入場 (タブ切替で再生)。
//     useReducedMotion() が true なら entering / pop とも無効。
//   - 「あたらしいスタンプを作る」は常設の大ボックスをやめ、グリッド先頭の
//     破線 chip に集約。タップでその場にフォーム展開 (作って送る = gradient)。
//   - 検索は入力中クリア (×) ボタン + 0 件時は「作っちゃおう」CTA。
//
// props 契約 {visible, onClose, onPick, picked, reactions} は不変。
// onPick(meme) は従来通り toggle セマンティクス (サーバー送信は親に委譲)。
// CommentThreadItem のように「mount 時に visible=true」で開く遅延マウントでも
// Modal の slide-in / entering stagger が初回 mount で正しく動く。
// ============================================================
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { MEMES, ALL_MEMES } from '../../lib/memes';
import { useUserStamps, useCreateUserStamp } from '../../hooks/useUserStamps';
import { useStampPrefsStore } from '../../stores/stampPrefsStore';
import { useToastStore } from '../../stores/toastStore';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { ReactionAgg } from '../../lib/api/reactions';
import { C, GRAD, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { hap } from '../../design/haptics';
import { EASE_OUT, SPRING_BOUNCY } from '../../design/motion';

// 特別タブの key (定型カテゴリの category 名と衝突しないよう __ prefix)
const TAB_POST = '__post';
const TAB_HISTORY = '__history';
const TAB_MYSTAMPS = '__mystamps';

// 送信タップ後に自動クローズするまでの時間 (pop を見せてから閉じる)
const AUTO_CLOSE_MS = 180;

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
  const reduceMotion = useReducedMotion();
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

  // 送信タップ → 自動クローズ用タイマー (連打時は最後のタップ基準で 1 回だけ)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 本体スクロール (タブ切替時に先頭へ戻す)
  const bodyRef = useRef<ScrollView>(null);

  // unmount 時にタイマーを必ず破棄 (遅延マウント呼び出し元で閉じた直後に unmount される)
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const cancelAutoClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleAutoClose = () => {
    cancelAutoClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      onClose();
    }, AUTO_CLOSE_MS);
  };

  // 手動クローズ (完了 / 背景タップ / Android back) — 保留中の自動クローズは捨てる
  const requestClose = () => {
    cancelAutoClose();
    onClose();
  };

  // 「この投稿で使われているスタンプ」= reactions を件数降順で
  const reactionStamps = useMemo(
    () => [...reactions].sort((a, b) => b.count - a.count).map((r) => r.meme),
    [reactions],
  );

  // マイスタンプ集合 (★ 表示判定用)
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
    cancelAutoClose();
    if (visible) {
      setBaselinePicked(new Set(picked));
      setSearchQuery('');
      setShowCustomInput(false);
      setCustomText('');
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

  // タップ = 送信 (未選択 → 送信して自動クローズ / 選択済 → 取り消しで開いたまま)
  const handleSend = (meme: string, wasPicked: boolean) => {
    setLocalFlips((prev) => {
      const next = new Set(prev);
      if (next.has(meme)) next.delete(meme);
      else next.add(meme);
      return next;
    });
    recordUse(meme); // 履歴に記録
    onPick(meme); // サーバー送信は親に委譲 (toggle セマンティクス不変)
    if (wasPicked) {
      // 取り消し: 「送った」わけではないので閉じない (連打 undo にも対応)
      cancelAutoClose();
    } else {
      // 送信: chip の pop を見せてから閉じる → 「送った感」
      scheduleAutoClose();
    }
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
      // 作って送る = 送信なのでこちらも自動クローズ
      scheduleAutoClose();
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
      // 保存の成功フィードバック (視覚 = chip の ★ + toast)
      hap.success();
      show('マイスタンプに保存しました', 'success');
    }
    setLongPressTarget(null);
  };

  const showingSearch = q.length > 0;
  const gridItems = showingSearch ? searchResults : tabItems;
  const targetSaved = longPressTarget ? myStampsSet.has(longPressTarget) : false;
  const canCreate = !!customText.trim() && !creating && !submitting;
  // タブ切替で stagger を再生させるための remount key (検索中は keystroke ごとの
  // 全 remount を避けるため固定 key にする — 新規ヒット分だけ個別に entering)
  const gridKey = showingSearch ? '__search' : activeTab;

  // 検索 0 件 → そのまま作成フォームへ (検索語をプリフィル)
  const openCreateFromSearch = () => {
    setCustomText(searchQuery.trim().slice(0, 40));
    setShowCustomInput(true);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={requestClose}>
      {/* 背景タップで閉じる (LINE 風) */}
      <Pressable
        onPress={requestClose}
        accessibilityLabel="閉じる"
        style={{ flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' }}
      >
        {/* シート本体 — タップは内側で止める (背景クローズに食われない) */}
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            maxHeight: '85%',
            backgroundColor: C.bg2,
            paddingBottom: insets.bottom + SP['3'],
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: C.border,
            gap: SP['3'],
          }}
        >
          {/* ドラッグハンドル + コンパクトなタイトル行 */}
          <View style={{ gap: SP['2'] }}>
            <View style={{ alignItems: 'center', paddingTop: SP['2'] }}>
              {/* C.bg3 はシート背景 (bg2) とほぼ同色で見えないため border2 を使う */}
              <View
                style={{ width: 36, height: 4, borderRadius: R.full, backgroundColor: C.border2 }}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP['4'] }}>
              <Text style={[T.bodyB, { color: C.text, flex: 1 }]}>テキストスタンプ</Text>
              <PressableScale
                onPress={requestClose}
                haptic="confirm"
                hitSlop={8}
                accessibilityLabel="完了"
                style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: SP['1'],
                  marginRight: -SP['2'],
                }}
              >
                <Text style={[T.smallB, { color: C.accent }]}>完了</Text>
              </PressableScale>
            </View>
          </View>

          {/* 検索バー (入力中はクリア × を出す) */}
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
                keyboardAppearance="dark"
                maxLength={200}
              />
              {searchQuery.length > 0 && (
                <PressableScale
                  onPress={() => setSearchQuery('')}
                  haptic="tap"
                  hitSlop={8}
                  accessibilityLabel="検索をクリア"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: R.full,
                    backgroundColor: C.bg4,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon.close size={12} color={C.text2} strokeWidth={2.4} />
                </PressableScale>
              )}
            </View>
          </View>

          {/* カテゴリタブ (検索中は隠す) — 選択中だけ gradient pill */}
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
                    onPress={() => {
                      if (tab.key === activeTab) return;
                      setActiveTab(tab.key);
                      // 切替時は本体スクロールを先頭へ (stagger が頭から見える)
                      bodyRef.current?.scrollTo({ y: 0, animated: false });
                    }}
                    haptic="tap"
                    scaleValue={0.95}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={{
                      borderRadius: R.full,
                      overflow: 'hidden',
                      borderWidth: 1,
                      borderColor: active ? 'transparent' : C.border,
                      backgroundColor: active ? 'transparent' : C.bg2,
                    }}
                  >
                    {active && (
                      <LinearGradient
                        colors={GRAD.primary}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                      />
                    )}
                    <Text
                      style={[
                        T.smallB,
                        {
                          color: active ? '#fff' : C.text2,
                          paddingHorizontal: SP['3'],
                          paddingVertical: 7,
                        },
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          )}

          {/* 本体 */}
          <ScrollView
            ref={bodyRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: SP['4'], paddingBottom: SP['4'], gap: SP['3'] }}
          >
            {/* その場で展開する作成フォーム (破線 chip / 検索 0 件 CTA から開く) */}
            {showCustomInput && (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(160)}
                style={{
                  gap: SP['2'],
                  padding: SP['3'],
                  backgroundColor: C.bg3,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.accent,
                }}
              >
                <Text style={[T.smallB, { color: C.accent }]}>
                  あたらしいスタンプを作る (40文字まで)
                </Text>
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
                      minHeight: 44,
                      justifyContent: 'center',
                      alignItems: 'center',
                      backgroundColor: C.bg,
                      borderRadius: R.md,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={[T.smallM, { color: C.text2 }]}>キャンセル</Text>
                  </PressableScale>
                  <PressableScale
                    onPress={handleCreate}
                    disabled={!canCreate}
                    haptic="confirm"
                    hitSlop={8}
                    accessibilityLabel="スタンプを作成して送る"
                    style={{
                      flex: 2,
                      minHeight: 44,
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderRadius: R.md,
                      overflow: 'hidden',
                      backgroundColor: C.bg4,
                      opacity: customText.trim() ? 1 : 0.6,
                    }}
                  >
                    {/* 入力がある時だけ gradient (空入力は無効グレー) */}
                    {!!customText.trim() && (
                      <LinearGradient
                        colors={GRAD.primary}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                      />
                    )}
                    {creating || submitting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={[T.buttonMd, { color: '#fff' }]}>作って送る</Text>
                    )}
                  </PressableScale>
                </View>
              </Animated.View>
            )}

            {/* スタンプグリッド (先頭に「＋ スタンプを作る」破線 chip) */}
            <View key={gridKey} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {!showingSearch && !showCustomInput && (
                <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(180)}>
                  <PressableScale
                    onPress={() => setShowCustomInput(true)}
                    haptic="tap"
                    accessibilityLabel="あたらしいスタンプを作る"
                    style={{
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: SP['1'],
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['2'],
                      borderRadius: R.full,
                      borderWidth: 1.5,
                      borderStyle: 'dashed',
                      borderColor: C.border2,
                    }}
                  >
                    <Icon.plus size={15} color={C.accent} strokeWidth={2.4} />
                    <Text style={[T.smallB, { color: C.accent }]}>スタンプを作る</Text>
                  </PressableScale>
                </Animated.View>
              )}
              {gridItems.map((m, i) => (
                <StampChip
                  key={m}
                  meme={m}
                  index={i}
                  isPicked={visiblyPicked.has(m)}
                  isSaved={myStampsSet.has(m)}
                  reduceMotion={reduceMotion}
                  onSend={handleSend}
                  onLongPress={setLongPressTarget}
                />
              ))}
            </View>

            {/* 空状態 (作成フォーム展開中は出さない) */}
            {gridItems.length === 0 &&
              !showCustomInput &&
              (showingSearch ? (
                // 検索 0 件 → friendly empty + そのまま作れる CTA
                <View style={{ alignItems: 'center', paddingVertical: SP['6'], gap: SP['3'] }}>
                  <Icon.sparkles size={28} color={C.text3} strokeWidth={2} />
                  <Text style={[T.smallM, { color: C.text3, textAlign: 'center' }]}>
                    {`「${searchQuery.trim()}」は見つからない…\n作っちゃおう`}
                  </Text>
                  <PressableScale
                    onPress={openCreateFromSearch}
                    haptic="tap"
                    accessibilityLabel="このテキストでスタンプを作る"
                    style={{
                      minHeight: 44,
                      justifyContent: 'center',
                      alignItems: 'center',
                      paddingHorizontal: SP['5'],
                      borderRadius: R.full,
                      overflow: 'hidden',
                    }}
                  >
                    <LinearGradient
                      colors={GRAD.primary}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                    />
                    <Text style={[T.smallB, { color: '#fff' }]}>＋ このまま作って送る</Text>
                  </PressableScale>
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: SP['6'], gap: SP['2'] }}>
                  <Icon.sparkles size={28} color={C.text3} strokeWidth={2} />
                  <Text style={[T.smallM, { color: C.text3, textAlign: 'center' }]}>
                    {activeTab === TAB_MYSTAMPS
                      ? '保存したスタンプはまだありません。\nスタンプを長押しで「マイスタンプに保存」できます。'
                      : activeTab === TAB_HISTORY
                        ? 'まだ使ったスタンプがありません'
                        : 'まだ誰もスタンプを押していません'}
                  </Text>
                </View>
              ))}

            {/* ヒント (控えめな caption) */}
            {gridItems.length > 0 && (
              <Text style={[T.caption, { color: C.text3, textAlign: 'center', marginTop: SP['1'] }]}>
                タップで送信・長押しでマイスタンプに保存
              </Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>

      {/* 長押し: マイスタンプ保存/解除のミニシート */}
      {longPressTarget !== null && (
        <Pressable
          onPress={() => setLongPressTarget(null)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: C.scrimLight,
            justifyContent: 'flex-end',
          }}
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
              <Text style={[T.small, { color: C.text3 }]}>選択中のスタンプ</Text>
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

// ============================================================
// StampChip — スタンプ 1 個分の chip (主役)
// ------------------------------------------------------------
//   - タップターゲット minHeight 44 + T.bodyB で「押せる感」を強調
//   - 送信タップで scale pop (worklet / transform のみ)。entering (FadeInDown
//     stagger) と transform が干渉しないよう、entering は外側 / pop は内側の
//     Animated.View に分離する
//   - 長押しは親のミニシート (保存/解除)。保存済みは小さな ★ を表示
// ============================================================
function StampChip({
  meme,
  index,
  isPicked,
  isSaved,
  reduceMotion,
  onSend,
  onLongPress,
}: {
  meme: string;
  index: number;
  isPicked: boolean;
  isSaved: boolean;
  reduceMotion: boolean;
  onSend: (meme: string, wasPicked: boolean) => void;
  onLongPress: (meme: string) => void;
}) {
  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const handlePress = () => {
    if (!isPicked && !reduceMotion) {
      // 送信ポップ: 一瞬ふくらんで spring で戻る (送った感)
      pop.value = withSequence(
        withTiming(1.16, { duration: 90, easing: EASE_OUT }),
        withSpring(1, SPRING_BOUNCY),
      );
    }
    onSend(meme, isPicked);
  };

  return (
    <Animated.View
      entering={
        reduceMotion ? undefined : FadeInDown.duration(180).delay(Math.min(index, 12) * 18)
      }
    >
      <Animated.View style={popStyle}>
        <PressableScale
          onPress={handlePress}
          onLongPress={() => onLongPress(meme)}
          // 送信 = confirm / 取り消し = select (press-in で即発火)
          haptic={isPicked ? 'select' : 'confirm'}
          accessibilityLabel={isPicked ? `スタンプ ${meme} を取り消す` : `スタンプ ${meme} を送る`}
          style={{
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'],
            backgroundColor: isPicked ? C.accent : C.bg3,
            borderRadius: R.full,
            borderWidth: 1.5,
            borderColor: isPicked ? C.accent : C.border,
          }}
        >
          <Text style={[T.bodyB, { color: isPicked ? '#fff' : C.text }]}>
            {isPicked ? '✓ ' : ''}
            {meme}
            {isSaved ? (
              <Text style={[T.caption, { color: isPicked ? '#fff' : C.amber }]}> ★</Text>
            ) : null}
          </Text>
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}
