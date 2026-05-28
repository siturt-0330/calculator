import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withTiming,
  withSequence,
  withSpring,
  interpolateColor,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { useBBSThread } from '../../hooks/useBBSThread';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useBBSReplyReactions, useBBSReplyReactionToggle } from '../../hooks/useBBSReplyReactions';
import { useIsCommunityMod } from '../../hooks/useIsCommunityMod';
import { MemeReactionPicker } from '../../components/feed/MemeReactionPicker';
import { MentionAutocomplete, type MentionTarget } from '../../components/bbs/MentionAutocomplete';
import { ModActionMenu } from '../../components/community/ModActionMenu';
import { C, SP, R, GRAD, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { formatRelative } from '../../lib/utils/date';
import { randomAvatarColor } from '../../lib/utils/color';
import { getThreadUserId } from '../../lib/utils/threadUserId';
import type { BBSReply } from '../../types/models';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { bbsReplyToObsidianNote, bbsThreadToObsidianNote } from '../../hooks/useObsidian';
import type { ReactionAgg } from '../../lib/api/bbsReplyReactions';
import { Icon } from '../../constants/icons';
import { notify, impact, Haptics } from '../../lib/haptics';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { isValidUuid } from '../../lib/validation';

const CATEGORY_COLORS: Record<string, string> = {
  '雑談': '#22D3A4', 'アニメ': '#FF6B7A', 'ゲーム': '#7CB1FF',
  'マンガ': '#F472B6', '音楽': '#FCD34D', 'アイドル': '#FF8C30',
  'Vtuber': '#A78BFA', '推し活': '#EC4899', 'グルメ': '#84CC16',
  'コスプレ': '#06B6D4', 'ニュース': '#94A3B8',
};
const MAX_W = 720;
// スクロール 600px 超で「先頭に戻る」pill を表示
const TOP_PILL_THRESHOLD = 600;
// 末尾から 120px 以内にいる時は「下にいる」と判定し新着 pill を出さない
const BOTTOM_PROXIMITY = 120;

// 返信本文を render するヘルパ。本文中の "&gt;&gt;N" を tappable span にする。
// 例: "テストです >>3 これも >>10" →
//   [Text("テストです ", normal), Text(">>3", tappable), Text(" これも ", normal), Text(">>10", tappable)]
//
// FlashList の renderItem 内で inline で構築すると複雑になるので関数に分離。
// onJump(n) は n が 1-based index (本文に書かれている数字そのまま) で呼ばれる。
function renderReplyBody(content: string, onJump: (n: number) => void) {
  // ">>" の後に 1 つ以上の数字。日本語間に来ても拾えるよう先読みは付けない。
  // 1-3 桁まで対応 (現実的なスレ件数の上限を超える長さは noise として除外しない方が安全)。
  const regex = />>(\d{1,4})/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > lastIndex) {
      parts.push(
        <Text key={`t-${key++}`} style={{ color: C.text }}>
          {content.slice(lastIndex, start)}
        </Text>,
      );
    }
    const numStr = match[1] ?? '';
    const num = parseInt(numStr, 10);
    parts.push(
      <Text
        key={`q-${key++}`}
        onPress={() => onJump(num)}
        suppressHighlighting
        style={{
          color: C.accentLight,
          fontWeight: '700',
          textDecorationLine: 'underline',
          textDecorationColor: C.accentGlow,
        }}
        accessibilityRole="link"
        accessibilityLabel={`>>${num} にジャンプ`}
      >
        {match[0]}
      </Text>,
    );
    lastIndex = end;
  }
  if (lastIndex < content.length) {
    parts.push(
      <Text key={`t-${key++}`} style={{ color: C.text }}>
        {content.slice(lastIndex)}
      </Text>,
    );
  }
  // 何もマッチしなかった場合は元の文字列のみ。
  if (parts.length === 0) {
    return <Text style={{ color: C.text }}>{content}</Text>;
  }
  return <>{parts}</>;
}

// 個別 reply 行 (highlight アニメ付き). renderItem から呼ばれる.
// highlightSeq を依存に取り、変わるたびに「自分が対象か」を判定して背景を一時 accent 化する.
function ReplyRow({
  item,
  index,
  threadId,
  threadTitle,
  reactions,
  onQuote,
  onJumpTo,
  onOpenPicker,
  onToggleReaction,
  highlightIndex,
  highlightSeq,
  communityId,
  isMod,
  currentUserId,
  onModActionComplete,
}: {
  item: BBSReply;
  index: number;
  threadId: string;
  threadTitle: string | undefined;
  reactions: ReactionAgg[];
  onQuote: (index: number) => void;
  onJumpTo: (n: number) => void;
  onOpenPicker: (id: string) => void;
  onToggleReaction: (replyId: string, meme: string) => void;
  highlightIndex: number | null;
  highlightSeq: number;
  // community 紐付き thread のみ ModActionMenu を render する
  communityId?: string | null;
  isMod: boolean;
  currentUserId?: string;
  onModActionComplete: () => void;
}) {
  // スレ内 ID — author_id + thread_id の hash で「同じ人 = 同じ ID」
  // 別スレでは別 ID。匿名性を保ちつつスレ内でキャラを認識できる仕組み。
  const threadUserId = item.author_id ? getThreadUserId(item.author_id, threadId) : null;

  // ジャンプ先 highlight: 200ms ほど accent 色に染めて目立たせる.
  // highlightSeq は「ジャンプが起きた回数」のカウンタ. 同じ index に複数回ジャンプ
  // しても useEffect が必ず発火するように seq を依存に入れる.
  const highlight = useSharedValue(0);
  useEffect(() => {
    if (highlightIndex === index) {
      // 0 → 1 (200ms) → 1 維持 (600ms) → 0 (400ms). 合計 1.2s ほど目立つ.
      highlight.value = withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(1, { duration: 600 }),
        withTiming(0, { duration: 400 }),
      );
    }
  }, [highlightIndex, highlightSeq, index, highlight]);
  const animStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      highlight.value,
      [0, 1],
      [C.bg2, C.accentBg],
    ),
    borderColor: interpolateColor(
      highlight.value,
      [0, 1],
      [C.border, C.accent],
    ),
  }));

  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <View style={{
        width: '100%', maxWidth: MAX_W,
        paddingHorizontal: SP['4'], paddingVertical: SP['2'],
      }}>
        <Animated.View style={[{
          padding: SP['3'],
          borderRadius: R.lg,
          borderWidth: 1,
          gap: SP['2'],
        }, animStyle]}>
          <View style={{ flexDirection: 'row', gap: SP['3'] }}>
            {/* 左: アバター + 番号 */}
            <View style={{ alignItems: 'center', gap: 2, width: 36 }}>
              <Avatar size={32} color={randomAvatarColor(item.id)} />
              <View style={{
                paddingHorizontal: 4, paddingVertical: 1,
                backgroundColor: C.bg3, borderRadius: R.sm,
                minWidth: 24, alignItems: 'center',
              }}>
                <Text style={{ fontSize: 9, color: C.text3, fontWeight: '700' }}>#{index + 1}</Text>
              </View>
            </View>
            {/* 右: 内容 */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginBottom: 4 }}>
                {/* スレ内 ID chip (2ch 風 ID:xxxxxx). 同じ投稿者は同じ ID, 別スレでは別 ID */}
                {threadUserId && (
                  <View style={{
                    paddingHorizontal: 6, paddingVertical: 1,
                    backgroundColor: C.bg3, borderRadius: R.sm,
                    borderWidth: 1, borderColor: C.border,
                  }}>
                    <Text style={{
                      fontSize: 10,
                      color: C.text3,
                      fontWeight: '700',
                      letterSpacing: 0.3,
                      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
                    }}>
                      ID:{threadUserId}
                    </Text>
                  </View>
                )}
                <Text style={[T.caption, { color: C.text3 }]}>{formatRelative(item.created_at)}</Text>
                <View style={{ flex: 1 }} />
                {/* >>N で返信 */}
                <PressableScale
                  onPress={() => onQuote(index)}
                  haptic="tap"
                  hitSlop={8}
                  accessibilityLabel={`>>${index + 1} で返信`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 3,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    backgroundColor: C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Text style={{ fontSize: 11, color: C.text2, fontWeight: '700' }}>
                    ↩ &gt;&gt;{index + 1}
                  </Text>
                </PressableScale>
                <PressableScale
                  onPress={() => onOpenPicker(item.id)}
                  haptic="tap"
                  hitSlop={10}
                  accessibilityLabel="リアクションを選ぶ"
                  style={{ padding: 4 }}
                >
                  <Text style={{ fontSize: 16 }}>🪶</Text>
                </PressableScale>
                <ObsidianSaveButton
                  note={bbsReplyToObsidianNote(item, threadTitle, threadId)}
                  size={16}
                />
                {/* mod 専用 3-dot — community 紐付き thread のみ. ModActionMenu 側で
                    isMod=false / isOwn=true は null render なので user 視点は透明 */}
                {communityId && item.author_id && (
                  <ModActionMenu
                    target={{
                      kind: 'bbs_reply',
                      replyId: item.id,
                      authorId: item.author_id,
                      threadId,
                    }}
                    communityId={communityId}
                    isMod={isMod}
                    isOwn={!!currentUserId && item.author_id === currentUserId}
                    onActionComplete={onModActionComplete}
                  />
                )}
              </View>
              {/* 本文 — >>N を tappable span 化 (ジャンプ機能) */}
              <Text style={[T.body, { color: C.text, lineHeight: 22 }]}>
                {renderReplyBody(item.content, onJumpTo)}
              </Text>
            </View>
          </View>

          {/* リアクション表示行 */}
          {reactions.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingLeft: 44 }}>
              {reactions.slice(0, 6).map((r) => (
                <PressableScale
                  key={r.meme}
                  onPress={() => onToggleReaction(item.id, r.meme)}
                  haptic="tap"
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: SP['2'], paddingVertical: 3,
                    backgroundColor: r.mine ? C.accentBg : C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1, borderColor: r.mine ? C.accent : C.border,
                  }}
                >
                  <Text style={{ fontSize: 11, color: r.mine ? C.accentLight : C.text2, fontWeight: '700' }}>
                    {r.meme}
                  </Text>
                  <Text style={{ fontSize: 10, color: r.mine ? C.accentLight : C.text3, fontWeight: '700' }}>
                    {r.count}
                  </Text>
                </PressableScale>
              ))}
              {reactions.length > 6 && (
                <PressableScale
                  onPress={() => onOpenPicker(item.id)}
                  haptic="tap"
                  style={{
                    paddingHorizontal: SP['2'], paddingVertical: 3,
                    backgroundColor: C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1, borderColor: C.border,
                  }}
                >
                  <Text style={{ fontSize: 10, color: C.text3, fontWeight: '700' }}>
                    +{reactions.length - 6}
                  </Text>
                </PressableScale>
              )}
            </View>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

export default function BBSThreadScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  // route param を UUID validation して cache DoS を防ぐ (詳細は lib/validation.ts)
  // BBS thread の id は UUID (supabase/migrations/0001_schema.sql の
  // bbs_threads.id uuid を参照). 不正なら空文字を渡して useBBSThread の
  // queryKey を bounded な ['bbs-thread', ''] に固定し、render 前に早期 return。
  const id = isValidUuid(rawId) ? rawId : null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const SendIcon = Icon.send;
  const BackIcon = Icon.arrowL;

  // ============================================================
  // Entering animation — Reddit iOS 風 "lift up & expand" 演出
  // ------------------------------------------------------------
  // post/[id] と同じパラメータ (damping 22 / stiffness 240 / mass 0.7) で統一。
  // BBS スレッドも modal slide-up (380ms) + scale 0.94 → 1.0 + fade で
  // 「タップしたスレッドカードが lift up」する錯視を作る。
  // ReducedMotion: 150ms timing で fade のみ。
  // ============================================================
  const reduceMotion = useReducedMotion();
  const enterProgress = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      enterProgress.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.cubic) });
    } else {
      enterProgress.value = withSpring(1, { damping: 22, stiffness: 240, mass: 0.7 });
    }
  }, [reduceMotion, enterProgress]);
  const enterStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: enterProgress.value };
    return {
      opacity: enterProgress.value,
      transform: [{ scale: 0.94 + enterProgress.value * 0.06 }],
    };
  });

  const { thread, replies, loading, refreshing, refresh, reply, error } = useBBSThread(id ?? '');
  const { show: showToast } = useToastStore();

  // mod 判定 (thread.community_id が null なら useIsCommunityMod は false を返す)
  const threadCommunityId = thread?.community_id ?? null;
  const isMod = useIsCommunityMod(threadCommunityId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const handleModActionComplete = useCallback(() => {
    if (!id) return;
    qc.invalidateQueries({ queryKey: ['bbs-replies', id] });
    qc.invalidateQueries({ queryKey: ['bbs-thread', id] });
  }, [qc, id]);

  // 入力欄への ref。クォート返信時に focus する。
  const inputRef = useRef<TextInput>(null);
  // FlashList の ref. ジャンプ機能で scrollToIndex / scrollToEnd / scrollToOffset を使う.
  const listRef = useRef<FlashList<BBSReply>>(null);

  // --- スクロール位置追跡 (新着 pill / 戻る pill 用) ---
  // - scrollAboveThreshold: 上端から TOP_PILL_THRESHOLD 超え (戻る pill 用)
  // - atBottom: 末尾 BOTTOM_PROXIMITY 内にいるか (新着 pill を出すかの判定)
  // - newReplyCount: 自分が下に居ない間に増えた件数
  // - prevRepliesLen: 直前 render での件数 (差分検出用)
  //
  // ★ パフォーマンス: 旧版は onScroll で setScrollY を毎フレーム呼んでいたため、
  //   スクロール中ずっと parent re-render が連鎖していた。worklet 上で
  //   閾値超過の boolean を計算し、変化したときだけ runOnJS で React state を
  //   更新する形に変更 (scroll event 1000 回 → setState は閾値またぎ時のみ)。
  const [scrollAboveThreshold, setScrollAboveThreshold] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newReplyCount, setNewReplyCount] = useState(0);
  const prevRepliesLen = useRef(replies.length);
  // worklet 側で前回値を保持して「閾値またぎ時だけ React 更新を発火」する
  const lastAboveSv = useSharedValue(false);
  const lastAtBottomSv = useSharedValue(true);

  // --- ジャンプ targeting ---
  // highlightIndex は「現在 highlight したい reply の index」、
  // highlightSeq は「同じ index にもう一度ジャンプした場合も発火させるためのカウンタ」.
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [highlightSeq, setHighlightSeq] = useState(0);

  // 「>>N で返信」: 該当番号を入力先頭に挿入してフォーカス。
  // 既に >>N が含まれていれば二重挿入しない。
  const quoteReply = useCallback((replyIndex: number) => {
    // bounds check — 範囲外の index を引用すると存在しない >>N が挿入されてしまう
    if (replyIndex < 0 || replyIndex >= replies.length) return;
    const tag = `>>${replyIndex + 1}`;
    setText((prev) => {
      if (prev.includes(tag)) return prev;
      const trimmed = prev.trim();
      return trimmed ? `${tag} ${trimmed}` : `${tag} `;
    });
    // ちょい遅延 focus (state 反映後)
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [replies.length]);

  // 本文中の "&gt;&gt;N" タップで該当 reply にジャンプ + highlight.
  // N は 1-based (本文に書かれている表記そのまま) → index は N-1.
  // 範囲外 (N が 0 / 件数超え) は no-op + 軽い toast でフィードバック.
  const jumpToReply = useCallback((n: number) => {
    const targetIndex = n - 1;
    if (targetIndex < 0 || targetIndex >= replies.length) {
      // 引用先が削除されたか、まだ存在しない番号. user に silent failure させない.
      showToast(`>>${n} は存在しません`, 'info');
      return;
    }
    // FlashList の scrollToIndex は viewPosition で「画面のどこに来るか」を制御.
    // 0.1 = 上端付近 (header の影響を少し見越して 0.1 にしておく).
    listRef.current?.scrollToIndex({
      index: targetIndex,
      animated: true,
      viewPosition: 0.1,
    });
    setHighlightIndex(targetIndex);
    // 同じ index への連続ジャンプでも useEffect が走るよう seq を bump.
    setHighlightSeq((s) => s + 1);
    impact(Haptics.ImpactFeedbackStyle.Light);
  }, [replies.length, showToast]);

  // 「最新の返信にジャンプ」 — 末尾までスクロール + 新着 counter リセット
  const jumpToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setNewReplyCount(0);
    impact(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // 「スレ先頭に戻る」 — offset 0 まで戻る (header も見えるように)
  const jumpToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    impact(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // 新着検出: 自分が下に居ない時に件数が増えた = 新着があった扱いで pill を表示.
  // 自分が下に居る場合は「ユーザーは見えているはず」なので counter は加算しない.
  useEffect(() => {
    const prev = prevRepliesLen.current;
    const curr = replies.length;
    if (curr > prev && !atBottom) {
      setNewReplyCount((c) => c + (curr - prev));
    }
    if (atBottom && newReplyCount !== 0) {
      // 下に来たら counter リセット (見える位置なので)
      setNewReplyCount(0);
    }
    prevRepliesLen.current = curr;
  }, [replies.length, atBottom, newReplyCount]);

  // スクロールイベント (UI スレッド実行 worklet).
  // 旧版は React state setter を毎フレーム呼んでおり、長スレで scroll jank の
  // 主因になっていた。worklet 内で閾値判定し、変化した瞬間だけ runOnJS で
  // 親 setState を発火する。「常に running な計算は UI thread」「state 反映は跨ぐ」
  // の使い分け。
  const handleScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      'worklet';
      const y = e.contentOffset.y;
      const distToBottom = e.contentSize.height - (y + e.layoutMeasurement.height);
      const above = y > TOP_PILL_THRESHOLD;
      const bottom = distToBottom <= BOTTOM_PROXIMITY;
      if (above !== lastAboveSv.value) {
        lastAboveSv.value = above;
        runOnJS(setScrollAboveThreshold)(above);
      }
      if (bottom !== lastAtBottomSv.value) {
        lastAtBottomSv.value = bottom;
        runOnJS(setAtBottom)(bottom);
      }
    },
  });

  // @メンション候補 (#1, #2, ...)
  const mentionTargets = useMemo<MentionTarget[]>(
    () => replies.map((r, i) => ({ id: r.id, label: `${i + 1}` })),
    [replies],
  );

  // テキストスタンプ (リアクション)
  const replyIds = useMemo(() => replies.map((r) => r.id), [replies]);
  const { data: reactionsByReply } = useBBSReplyReactions(replyIds);
  const { toggle: toggleReaction } = useBBSReplyReactionToggle();
  const [pickerForReplyId, setPickerForReplyId] = useState<string | null>(null);
  const pickerReactions = pickerForReplyId ? (reactionsByReply[pickerForReplyId] ?? []) : [];
  const pickerMine = pickerReactions.filter((r) => r.mine).map((r) => r.meme);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await reply(text.trim());
      setText('');
      notify(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      // 以前は haptic だけで toast が出ず、ユーザーには「ボタンを押したのに何も起きない」
      // ように見えていた。失敗時は明示的にトーストでフィードバックする。
      notify(Haptics.NotificationFeedbackType.Error);
      const msg = e instanceof Error ? e.message : '';
      showToast(msg ? `送信に失敗しました: ${msg}` : '送信に失敗しました', 'error');
    } finally {
      setSending(false);
    }
  };

  // route param validation 失敗 → cache 汚染を防ぐため早期 return
  // 早期 return も entering animation の対象にする (一貫した lift-up 体感)。
  if (!id) {
    return (
      <Animated.View style={[{ flex: 1, backgroundColor: C.bg }, enterStyle]}>
        <Header insets={insets} router={router} BackIcon={BackIcon} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP['6'] }}>
          <Text style={[T.body, { color: C.text2 }]}>無効な URL です</Text>
        </View>
      </Animated.View>
    );
  }

  if (loading) {
    return (
      <Animated.View style={[{ flex: 1, backgroundColor: C.bg }, enterStyle]}>
        <Header insets={insets} router={router} BackIcon={BackIcon} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
      </Animated.View>
    );
  }

  if (error || !thread) {
    const isNotFound = !error && !thread;
    const errMsg = error instanceof Error ? error.message : String(error ?? '');
    return (
      <Animated.View style={[{ flex: 1, backgroundColor: C.bg }, enterStyle]}>
        <Header insets={insets} router={router} BackIcon={BackIcon} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP['6'], gap: SP['4'] }}>
          <Text style={{ fontSize: 56 }}>{isNotFound ? '🔍' : '📭'}</Text>
          <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
            {isNotFound ? 'このスレッドは削除されました' : 'スレッドを読み込めませんでした'}
          </Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            {isNotFound
              ? '掲示板一覧から最新のスレッドを開いてください'
              : '通信エラーまたはアクセス権限の問題かもしれません'}
          </Text>
          {errMsg && !isNotFound && (
            <Text style={[T.caption, { color: C.text3, textAlign: 'center', maxWidth: 320 }]}>
              {errMsg}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: SP['3'] }}>
            <PressableScale
              onPress={() => refresh()}
              haptic="confirm"
              style={{ paddingHorizontal: SP['5'], paddingVertical: SP['3'], backgroundColor: C.accent, borderRadius: R.full }}
            >
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>再試行</Text>
            </PressableScale>
            <PressableScale
              onPress={() => router.replace('/(tabs)/bbs' as never)}
              haptic="tap"
              style={{ paddingHorizontal: SP['5'], paddingVertical: SP['3'], backgroundColor: C.bg3, borderRadius: R.full, borderWidth: 1, borderColor: C.border }}
            >
              <Text style={[T.smallM, { color: C.text }]}>掲示板に戻る</Text>
            </PressableScale>
          </View>
        </View>
      </Animated.View>
    );
  }

  const catColor = thread.category ? (CATEGORY_COLORS[thread.category] ?? C.accent) : C.accent;
  const canSend = text.trim().length > 0 && !sending;

  const renderReply = ({ item, index }: { item: BBSReply; index: number }) => {
    const reactions: ReactionAgg[] = reactionsByReply[item.id] ?? [];
    return (
      <ReplyRow
        item={item}
        index={index}
        threadId={id}
        threadTitle={thread?.title}
        reactions={reactions}
        onQuote={quoteReply}
        onJumpTo={jumpToReply}
        onOpenPicker={setPickerForReplyId}
        onToggleReaction={toggleReaction}
        highlightIndex={highlightIndex}
        highlightSeq={highlightSeq}
        communityId={threadCommunityId}
        isMod={isMod}
        currentUserId={currentUserId}
        onModActionComplete={handleModActionComplete}
      />
    );
  };

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: C.bg }, enterStyle]}>
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Header insets={insets} router={router} BackIcon={BackIcon} />

      <View style={{ flex: 1 }}>
        <FlashList
          ref={listRef}
          data={replies}
          keyExtractor={(item) => item.id}
          renderItem={renderReply}
          // 短めの返信が多いスレで estimatedItemSize を 100 に下げ初期描画を引き締める.
          // 平均長めなら自動補正される (FlashList は実測でリサイズ).
          estimatedItemSize={100}
          // ★ extraData: useBBSReplyReactionToggle が legacy ['bbs-reply-reactions']
          //   cache のみ更新するため data=replies は不変 → FlashList が chip を
          //   描き直さない。reactionsByReply + highlight 状態を extraData に渡して cache 更新
          //   時に強制再 render させる。詳細は feed.tsx の同位置コメント参照。
          extraData={{ reactionsByReply, highlightIndex, highlightSeq }}
          // 返信入力中に >>N ボタンを 1 タップで操作できるよう keyboard を保持
          keyboardShouldPersistTaps="handled"
          // スワイプフリック時の慣性減速を速める (スクロール感がキビキビになる)
          decelerationRate="fast"
          // viewport 外で +250px 先読み (スクロール中の白セル防止)
          drawDistance={250}
          // 長いスレッドではオフスクリーンセルを unmount してメモリ/描画コスト削減
          removeClippedSubviews
          onScroll={handleScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.accent} />
          }
          ListHeaderComponent={
            <View style={{ width: '100%', alignItems: 'center' }}>
              <View style={{ width: '100%', maxWidth: MAX_W, paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['3'] }}>
                <View style={{
                  padding: SP['4'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1, borderColor: C.border,
                  overflow: 'hidden',
                  position: 'relative',
                }}>
                  {/* 左カラーバー */}
                  <View style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                    backgroundColor: catColor,
                  }} />
                  <View style={{ paddingLeft: SP['2'], gap: SP['2'] }}>
                    {thread.category && (
                      <View style={{
                        alignSelf: 'flex-start',
                        paddingHorizontal: SP['2'], paddingVertical: 3,
                        backgroundColor: catColor + '22',
                        borderRadius: R.sm,
                        borderWidth: 1, borderColor: catColor + '55',
                      }}>
                        <Text style={[T.caption, { color: catColor, fontWeight: '700' }]}>
                          {thread.category}
                        </Text>
                      </View>
                    )}
                    <Text style={[T.h2, { color: C.text, fontWeight: '800', lineHeight: 30 }]}>
                      {thread.title}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Icon.comment size={13} color={C.text3} strokeWidth={2.2} />
                        <Text style={[T.caption, { color: C.text3, fontWeight: '600' }]}>
                          {replies.length} 件の返信
                        </Text>
                      </View>
                      <Text style={[T.caption, { color: C.text3 }]}>·</Text>
                      <Text style={[T.caption, { color: C.text3 }]}>
                        {formatRelative(thread.created_at)}
                      </Text>
                      <View style={{ flex: 1 }} />
                      <ObsidianSaveButton note={bbsThreadToObsidianNote(thread)} size={16} />
                    </View>
                  </View>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={{ width: '100%', alignItems: 'center' }}>
              <View style={{
                width: '100%', maxWidth: MAX_W,
                padding: SP['6'], alignItems: 'center', gap: SP['2'],
              }}>
                {/* 装飾絵文字 (💬) 撤去 */}
                <Text style={[T.bodyMd, { color: C.text2 }]}>
                  まだ返信はありません
                </Text>
                <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
                  最初に投稿してこのスレッドを盛り上げよう
                </Text>
              </View>
            </View>
          }
        />

        {/* フローティング pill 群. position: absolute で list の上に乗せる. */}
        {/* 右下 column. desktop でも MAX_W を超えない側に寄せる必要は無いので右側固定. */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            right: SP['4'],
            bottom: SP['4'],
            gap: SP['2'],
            alignItems: 'flex-end',
          }}
        >
          {/* 「↓ 新着 N 件」 pill — gradient + glow. 自分が下にいる時は非表示. */}
          {!atBottom && newReplyCount > 0 && (
            <PressableScale
              onPress={jumpToBottom}
              haptic="tap"
              accessibilityLabel={`新着 ${newReplyCount} 件にジャンプ`}
              style={[{
                borderRadius: R.full,
                overflow: 'hidden',
              }, SHADOW.glow]}
            >
              <LinearGradient
                colors={GRAD.primary as unknown as readonly [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: SP['3'],
                  paddingVertical: 8,
                }}
              >
                <Text style={{ fontSize: 13, color: '#fff', fontWeight: '800' }}>
                  ↓ 新着 {newReplyCount} 件
                </Text>
              </LinearGradient>
            </PressableScale>
          )}

          {/* 「↑ 先頭に戻る」 pill — 600px 超えで出す. 控えめな gradient. */}
          {scrollAboveThreshold && (
            <PressableScale
              onPress={jumpToTop}
              haptic="tap"
              accessibilityLabel="スレ先頭に戻る"
              style={[{
                borderRadius: R.full,
                overflow: 'hidden',
              }, SHADOW.sm]}
            >
              <LinearGradient
                colors={GRAD.primarySoft as unknown as readonly [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 40,
                  height: 40,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 18, color: '#fff', fontWeight: '800', lineHeight: 20 }}>↑</Text>
              </LinearGradient>
            </PressableScale>
          )}
        </View>
      </View>

      {/* @メンション候補 (返信入力バーの上) */}
      <View style={{ width: '100%', alignItems: 'center', backgroundColor: C.bg }}>
        <View style={{ width: '100%', maxWidth: MAX_W, paddingHorizontal: SP['3'] }}>
          <MentionAutocomplete
            input={text}
            candidates={mentionTargets}
            onPick={(target) => {
              // @<token> を @<label> に置換
              const at = text.lastIndexOf('@');
              if (at === -1) return;
              const before = text.slice(0, at);
              setText(`${before}@${target.label} `);
            }}
          />
        </View>
      </View>

      {/* 返信入力バー — keyboard visible 時の "浮き" を強める shadow / 文字色を打ち消す border */}
      <View style={{
        width: '100%',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: C.border,
        backgroundColor: C.bg2,
      }}>
        <View style={{
          width: '100%', maxWidth: MAX_W,
          paddingHorizontal: SP['3'],
          paddingTop: SP['2'],
          paddingBottom: insets.bottom + SP['2'],
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: SP['2'],
        }}>
          <View style={{
            flex: 1,
            backgroundColor: C.bg3,
            borderRadius: R.lg,
            borderWidth: 1.5,
            // フォーカス中は border を accent に. text 入力済み (focus 外) は soft accent.
            borderColor: isFocused ? C.accent : (text.trim() ? C.accentLight : C.border),
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
          }}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="返信を入力…"
              placeholderTextColor={C.text3}
              multiline
              maxLength={500}
              keyboardAppearance="dark"
              selectionColor={C.accent}
              style={[
                T.body,
                {
                  color: C.text,
                  maxHeight: 100,
                  minHeight: 24,
                  paddingVertical: 0,
                },
              ]}
            />
            {/* 文字数 chip — 右下にミニ pill 化. 450 超で amber に. */}
            {text.length > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 }}>
                <View style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: R.full,
                  backgroundColor: text.length > 450 ? C.amberBg : C.bg4,
                  borderWidth: 1,
                  borderColor: text.length > 450 ? C.amber : C.border,
                }}>
                  <Text style={{
                    fontSize: 10,
                    color: text.length > 450 ? C.amber : C.text3,
                    fontWeight: '700',
                    letterSpacing: 0.3,
                    fontVariant: ['tabular-nums'],
                  }}>
                    {text.length} / 500
                  </Text>
                </View>
              </View>
            )}
          </View>
          {/* 送信ボタン — gradient + glow. disabled 時はフラット. */}
          <PressableScale
            onPress={handleSend}
            disabled={!canSend}
            haptic="confirm"
            accessibilityLabel="送信"
            style={[
              {
                width: 44, height: 44, borderRadius: 22,
                overflow: 'hidden',
                alignItems: 'center', justifyContent: 'center',
              },
              canSend ? SHADOW.glow : undefined,
            ]}
          >
            {canSend ? (
              <LinearGradient
                colors={GRAD.primary as unknown as readonly [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <SendIcon size={20} color="#fff" strokeWidth={2.4} />
                )}
              </LinearGradient>
            ) : (
              <View style={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: C.bg4,
                borderWidth: 1.5,
                borderColor: C.border,
                borderRadius: 22,
              }}>
                <SendIcon size={20} color={C.text3} strokeWidth={2.4} />
              </View>
            )}
          </PressableScale>
        </View>
      </View>

      <MemeReactionPicker
        visible={!!pickerForReplyId}
        onClose={() => setPickerForReplyId(null)}
        onPick={(meme) => {
          if (pickerForReplyId) toggleReaction(pickerForReplyId, meme);
        }}
        picked={pickerMine}
      />
    </KeyboardAvoidingView>
    </Animated.View>
  );
}

function Header({
  insets, router, BackIcon,
}: {
  insets: { top: number };
  router: { back: () => void };
  BackIcon: React.ComponentType<Record<string, unknown>>;
}) {
  return (
    <View style={{ alignItems: 'center', backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{
        width: '100%', maxWidth: MAX_W,
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: SP['3'], paddingVertical: SP['2'],
      }}>
        <PressableScale
          onPress={() => router.back()}
          haptic="tap"
          hitSlop={12}
          accessibilityLabel="戻る"
          style={{ padding: SP['2'] }}
        >
          <BackIcon size={22} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <Text style={[T.smallM, { color: C.text3, marginLeft: SP['2'] }]}>💬 掲示板</Text>
      </View>
    </View>
  );
}
