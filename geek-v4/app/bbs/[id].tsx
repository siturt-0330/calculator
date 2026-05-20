import { useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useBBSThread } from '../../hooks/useBBSThread';
import { useBBSReplyReactions, useBBSReplyReactionToggle } from '../../hooks/useBBSReplyReactions';
import { MemeReactionPicker } from '../../components/feed/MemeReactionPicker';
import { MentionAutocomplete, type MentionTarget } from '../../components/bbs/MentionAutocomplete';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { TrustBadge } from '../../components/ui/TrustBadge';
import { formatRelative } from '../../lib/utils/date';
import { randomAvatarColor } from '../../lib/utils/color';
import type { BBSReply } from '../../types/models';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { bbsReplyToObsidianNote, bbsThreadToObsidianNote } from '../../hooks/useObsidian';
import type { ReactionAgg } from '../../lib/api/bbsReplyReactions';
import { Icon } from '../../constants/icons';
import { notify, Haptics } from '../../lib/haptics';

const CATEGORY_COLORS: Record<string, string> = {
  '雑談': '#22D3A4', 'アニメ': '#FF6B7A', 'ゲーム': '#7CB1FF',
  'マンガ': '#F472B6', '音楽': '#FCD34D', 'アイドル': '#FF8C30',
  'Vtuber': '#A78BFA', '推し活': '#EC4899', 'グルメ': '#84CC16',
  'コスプレ': '#06B6D4', 'ニュース': '#94A3B8',
};
const MAX_W = 720;

export default function BBSThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width > MAX_W;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const SendIcon = Icon.send;
  const BackIcon = Icon.arrowL;

  const { thread, replies, loading, refreshing, refresh, reply, error } = useBBSThread(id);

  // 入力欄への ref。クォート返信時に focus する。
  const inputRef = useRef<TextInput>(null);

  // 「>>N で返信」: 該当番号を入力先頭に挿入してフォーカス。
  // 既に >>N が含まれていれば二重挿入しない。
  const quoteReply = useCallback((replyIndex: number) => {
    const tag = `>>${replyIndex + 1}`;
    setText((prev) => {
      if (prev.includes(tag)) return prev;
      const trimmed = prev.trim();
      return trimmed ? `${tag} ${trimmed}` : `${tag} `;
    });
    // ちょい遅延 focus (state 反映後)
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

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
    } catch {
      notify(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Header insets={insets} router={router} BackIcon={BackIcon} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
      </View>
    );
  }

  if (error || !thread) {
    const isNotFound = !error && !thread;
    const errMsg = error instanceof Error ? error.message : String(error ?? '');
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
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
      </View>
    );
  }

  const catColor = thread.category ? (CATEGORY_COLORS[thread.category] ?? C.accent) : C.accent;

  const renderReply = ({ item, index }: { item: BBSReply; index: number }) => {
    const reactions: ReactionAgg[] = reactionsByReply[item.id] ?? [];
    return (
      <View style={{ width: '100%', alignItems: 'center' }}>
        <View style={{
          width: '100%', maxWidth: MAX_W,
          paddingHorizontal: SP['4'], paddingVertical: SP['2'],
        }}>
          <View style={{
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1, borderColor: C.border,
            gap: SP['2'],
          }}>
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
                  <TrustBadge score={item.trust_score} />
                  <Text style={[T.caption, { color: C.text3 }]}>{formatRelative(item.created_at)}</Text>
                  <View style={{ flex: 1 }} />
                  {/* >>N で返信 */}
                  <PressableScale
                    onPress={() => quoteReply(index)}
                    haptic="tap"
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
                    onPress={() => setPickerForReplyId(item.id)}
                    haptic="tap"
                    style={{ padding: 4 }}
                  >
                    <Text style={{ fontSize: 16 }}>🪶</Text>
                  </PressableScale>
                  <ObsidianSaveButton
                    note={bbsReplyToObsidianNote(item, thread?.title, thread?.id)}
                    size={16}
                  />
                </View>
                <Text style={[T.body, { color: C.text, lineHeight: 22 }]}>{item.content}</Text>
              </View>
            </View>

            {/* リアクション表示行 */}
            {reactions.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingLeft: 44 }}>
                {reactions.slice(0, 6).map((r) => (
                  <PressableScale
                    key={r.meme}
                    onPress={() => toggleReaction(item.id, r.meme)}
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
                    onPress={() => setPickerForReplyId(item.id)}
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
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Header insets={insets} router={router} BackIcon={BackIcon} />

      <FlashList
        data={replies}
        keyExtractor={(item) => item.id}
        renderItem={renderReply}
        estimatedItemSize={120}
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
              <Text style={{ fontSize: 40 }}>💬</Text>
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

      {/* 返信入力バー */}
      <View style={{ width: '100%', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 }}>
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
            borderWidth: 1,
            borderColor: text.trim() ? C.accent : C.border,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
          }}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
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
            {text.length > 0 && (
              <Text style={{ fontSize: 10, color: text.length > 450 ? C.amber : C.text3, textAlign: 'right' }}>
                {text.length} / 500
              </Text>
            )}
          </View>
          <PressableScale
            onPress={handleSend}
            disabled={!text.trim() || sending}
            haptic="confirm"
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: text.trim() && !sending ? C.accent : C.bg4,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 2, borderColor: text.trim() && !sending ? C.accent : C.border,
            }}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <SendIcon size={20} color={text.trim() ? '#fff' : C.text3} strokeWidth={2.4} />
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
        <PressableScale onPress={() => router.back()} haptic="tap" style={{ padding: SP['2'] }}>
          <BackIcon size={22} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <Text style={[T.smallM, { color: C.text3, marginLeft: SP['2'] }]}>💬 掲示板</Text>
      </View>
    </View>
  );
}
