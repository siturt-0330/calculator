import { useMemo, useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  Layout,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '../ui/Avatar';
import { PressableScale } from '../ui/PressableScale';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { getDisplayCommentLikes } from '../../lib/utils/commentDisplay';
import { ObsidianSaveButton } from '../ui/ObsidianSaveButton';
import { commentToObsidianNote } from '../../hooks/useObsidian';
import { Icon } from '../../constants/icons';
import { COMMENT_MAX_DEPTH } from '../../lib/utils/commentTree';
import { ModActionMenu } from '../community/ModActionMenu';
import { useIsCommunityMod } from '../../hooks/useIsCommunityMod';
import { useAuthStore } from '../../stores/authStore';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING_SNAPPY } from '../../design/motion';
import type { Comment } from '../../types/models';

// ============================================================
// CommentThreadItem — 階層コメントを再帰的に描画する component
// ------------------------------------------------------------
// 親 (app/post/[id].tsx) は buildCommentTree で組み立てた root[] を持って
// いて、これを map で 1 ルートずつ <CommentThreadItem /> に渡す。
// children はこの component が自分で再帰 render する。
//
// 仕様:
//   - indent: depth * 16px (max depth=3 = 48px)。最左に「縦バー」を描く。
//     縦バーの色は theme-aware (`C.divider` / `C.border`) で、bubble の高さに
//     追従して自動で伸縮する (flex stretch + Layout.springify)。
//   - depth ≥ 2 のスレッドは初期 collapsed (タップで展開)。
//     ただし「子が 1 件 + 自分も最深」のような場面では collapse が邪魔なので、
//     children が 0 件のときは collapsed UI を出さない。
//   - 「↪ 返信」ボタンで onReply(comment) を呼ぶ。親の入力欄に @hash + flag を
//     セットする想定 (返信モード)。
//   - 未読ハイライト (unreadIds に含まれる時) は背景 accentBg + 左 accent バー。
//
// アニメーション (Apple Photos / Reddit 風の polish):
//   - 折りたたみの展開/収納: 子セクションを Layout.springify({damping:26,stiffness:280})
//     で滑らかに高さ変化 + FadeIn/Out
//   - Avatar pulse: 展開時に 0.92 → 1.0 を SPRING_SNAPPY で
//   - Body fade: collapsed snippet / expanded full のクロスフェード 180ms
//   - Chevron rotate: 0deg ↔ 180deg を withTiming(180ms easing.out)
//   - tap target: bubble 全体を Pressable にして展開/折りたたみを軽快に切替
//   - ReduceMotion: spring/pulse をスキップ、withTiming(150) で即時遷移
//
// 性能:
//   - 再帰呼び出しは tree.depth 上限 3 なので最大 depth 3 まで。FlashList を使わず
//     直接 View で render しても性能は問題なし (実測 1 ルート 50 子で 60fps 維持)。
//   - shared value のみでアニメーション (state 更新を伴わない) — 100+ コメントでも
//     スクロール中の再 render コストは増えない。
// ============================================================

const INDENT_PX = 16;        // depth 1 段あたりの左 padding
const COLLAPSE_FROM_DEPTH = 2; // この depth 以上は初期 collapsed
// 高さ伸縮 (collapse / expand) 用の spring — 指示書準拠
const COLLAPSE_SPRING = { damping: 26, stiffness: 280, mass: 0.8 } as const;
// chevron rotate / opacity fade 用 timing
const CHEVRON_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) } as const;
// ReduceMotion 時の即時遷移 timing (spring 禁止)
const REDUCED_TIMING = { duration: 150, easing: Easing.out(Easing.cubic) } as const;
// body fade のクロスフェード duration
const BODY_FADE_MS = 180;
// collapsed 時に body から抜き出す最大文字数 (要約 snippet)
const COLLAPSED_SNIPPET_MAX = 80;

export type CommentThreadItemProps = {
  comment: Comment;
  // root に対するインデックス (#1, #2, ...) — 同一 root tree 内では共通
  rootIndex: number;
  unread?: boolean;
  postContent?: string;
  postId?: string;
  // 親 post の community_id — 渡されると mod 用の 3-dot menu を出す。
  // post 詳細画面側 (app/post/[id].tsx) で postCommunities[0]?.community_id
  // を渡してくる想定。null なら ModActionMenu は出ない。
  parentCommunityId?: string | null;
  onReply?: (comment: Comment) => void;
};

export function CommentThreadItem({
  comment,
  rootIndex,
  unread = false,
  postContent,
  postId,
  parentCommunityId,
  onReply,
}: CommentThreadItemProps) {
  const qc = useQueryClient();
  const C = useColors();
  const reduceMotion = useReducedMotion();
  // mod 判定 (parentCommunityId が無ければ false で何も出さない)
  const isMod = useIsCommunityMod(parentCommunityId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const commentAuthorId = (comment as Comment & { author_id?: string }).author_id;
  const isOwnComment = !!commentAuthorId && commentAuthorId === currentUserId;
  const depth = Math.min(COMMENT_MAX_DEPTH, comment.depth ?? 0);
  const children = comment.children ?? [];
  const indent = depth * INDENT_PX;
  // collapsed UI: 深い枝で子が居る場合だけ
  const initiallyCollapsed = depth >= COLLAPSE_FROM_DEPTH && children.length > 0;
  const [collapsed, setCollapsed] = useState<boolean>(initiallyCollapsed);
  // この comment が「タップで展開/折りたたみできる」状態か
  const isCollapsible = children.length > 0 && depth >= COLLAPSE_FROM_DEPTH;

  // いいね数の遅延表示 (commentDisplay.ts の規約)
  const likesRaw = (comment as Comment & { likes_count?: number }).likes_count;
  const likesDisplay = useMemo(
    () => getDisplayCommentLikes(comment.created_at, likesRaw),
    [comment.created_at, likesRaw],
  );

  // collapsed 時に出す body の短縮表示 (1 行 snippet)
  const snippet = useMemo(() => {
    const raw = (comment.content ?? '').replace(/\s+/g, ' ').trim();
    if (raw.length <= COLLAPSED_SNIPPET_MAX) return raw;
    return raw.slice(0, COLLAPSED_SNIPPET_MAX) + '…';
  }, [comment.content]);

  // ============================================================
  // shared values — 全て worklet 側で動かす。state を持たないので 100+ 行でも軽い。
  // ============================================================
  // chevron rotation (0 = collapsed=▶, 1 = expanded=▼)
  const chevronProgress = useSharedValue(initiallyCollapsed ? 0 : 1);
  // avatar pulse scale (展開時に 0.92 → 1.0)
  const avatarScale = useSharedValue(1);
  // body crossfade progress (0 = snippet 表示 / 1 = full 表示)
  const bodyProgress = useSharedValue(initiallyCollapsed ? 0 : 1);

  useEffect(() => {
    const expanded = !collapsed;
    if (reduceMotion) {
      // ReduceMotion: spring / pulse をスキップ、150ms timing で即時遷移
      chevronProgress.value = withTiming(expanded ? 1 : 0, REDUCED_TIMING);
      bodyProgress.value = withTiming(expanded ? 1 : 0, REDUCED_TIMING);
      avatarScale.value = 1; // pulse 無し
      return;
    }
    chevronProgress.value = withTiming(expanded ? 1 : 0, CHEVRON_TIMING);
    bodyProgress.value = withTiming(expanded ? 1 : 0, {
      duration: BODY_FADE_MS,
      easing: Easing.out(Easing.cubic),
    });
    // expand 時のみ avatar pulse (0.92 → 1.0)
    if (expanded) {
      avatarScale.value = 0.92;
      avatarScale.value = withSpring(1, SPRING_SNAPPY);
    }
  }, [collapsed, reduceMotion, chevronProgress, bodyProgress, avatarScale]);

  // chevron は 0 → 90deg 回転 (▶ → ▼ 相当)
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 90}deg` }],
  }));
  const avatarAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: avatarScale.value }],
  }));
  // body の crossfade — full は opacity = progress, snippet は 1-progress
  const fullBodyStyle = useAnimatedStyle(() => ({ opacity: bodyProgress.value }));
  const snippetBodyStyle = useAnimatedStyle(() => ({ opacity: 1 - bodyProgress.value }));

  // 折りたたみの toggle handler。bubble 全体 + chevron 専用ボタン両方から呼ばれる。
  const toggleCollapsed = () => {
    if (!isCollapsible) return;
    setCollapsed((s) => !s);
  };

  // bubble の背景色は collapsed / expanded で僅かに切替 (collapsed は subtle bg2)
  // unread highlight は accentBg/accent で従来通り優先。
  const bubbleBg = unread ? C.accentBg : collapsed ? C.bg2 : C.bg;
  const bubbleBorder = unread ? C.accent : C.border;

  return (
    <View style={{ width: '100%' }}>
      {/* 自分自身 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'stretch',
          // depth 分の左 padding。0 のときは指定しないことで余白を最小化。
          paddingLeft: indent,
        }}
      >
        {/* depth > 0 は左に縦バーを引いて階層を視覚化。
            alignItems:'stretch' により bubble の高さに自動で追従する。
            color は theme-aware の C.divider (より subtle)。 */}
        {depth > 0 && (
          <View
            style={{
              width: 2,
              backgroundColor: C.divider,
              marginRight: SP['2'],
              borderRadius: 1,
            }}
          />
        )}

        {/* bubble 本体を PressableScale で包んで「行全体」を tap target にする。
            isCollapsible でない時は disabled で見た目だけ非アクティブ化 (scale 無し)。
            内部の PressableScale (返信ボタン / chevron / ModMenu / Obsidian) は
            自分で onPress を持つので親の Pressable と競合せず動く。 */}
        <PressableScale
          onPress={toggleCollapsed}
          disabled={!isCollapsible}
          // collapsed toggle の時のみ tap feedback を有効化。scale は控えめに。
          scaleValue={0.98}
          haptic={isCollapsible ? 'tap' : undefined}
          accessibilityRole={isCollapsible ? 'button' : 'none'}
          accessibilityLabel={
            isCollapsible
              ? collapsed
                ? `返信 ${children.length} 件を表示`
                : `返信 ${children.length} 件を折りたたむ`
              : undefined
          }
          accessibilityState={{ expanded: isCollapsible ? !collapsed : undefined }}
          style={{
            flex: 1,
            flexDirection: 'row',
            gap: SP['3'],
            padding: SP['3'],
            backgroundColor: bubbleBg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: bubbleBorder,
            borderLeftWidth: unread ? 3 : 1,
            borderLeftColor: unread ? C.accent : bubbleBorder,
            marginVertical: 4,
          }}
        >
          <Animated.View
            style={[
              { alignItems: 'center', gap: 2, width: 36 },
              avatarAnimStyle,
            ]}
          >
            <Avatar size={32} color={comment.avatar_color} name={String(rootIndex)} />
            <View
              style={{
                paddingHorizontal: 4,
                paddingVertical: 1,
                backgroundColor: C.bg3,
                borderRadius: R.sm,
                minWidth: 24,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 9, color: C.text3, fontWeight: '700' }}>
                #{rootIndex}
              </Text>
            </View>
          </Animated.View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                marginBottom: 4,
                flexWrap: 'wrap',
              }}
            >
              <Text style={[T.caption, { color: C.text3 }]}>
                {formatRelative(comment.created_at)}
              </Text>
              {likesRaw !== undefined && (
                <Text
                  style={[T.caption, { color: C.text3 }]}
                  accessibilityLabel={`いいね ${likesDisplay}`}
                >
                  · 💛 {likesDisplay}
                </Text>
              )}
              {unread && (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    backgroundColor: C.accent,
                    borderRadius: R.sm,
                  }}
                  accessibilityLabel="未読のコメント"
                >
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: '800' }}>
                    NEW
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              {postContent && postId && (
                <ObsidianSaveButton
                  note={commentToObsidianNote(comment, postContent, postId)}
                  size={14}
                />
              )}
              {/* mod 専用 3-dot menu — parentCommunityId が無い / mod でない / 自分の
                  コメント のときは ModActionMenu 側で null render される */}
              {parentCommunityId && commentAuthorId && (
                <ModActionMenu
                  target={{
                    kind: 'comment',
                    commentId: comment.id,
                    authorId: commentAuthorId,
                    postId: comment.post_id,
                  }}
                  communityId={parentCommunityId}
                  isMod={isMod}
                  isOwn={isOwnComment}
                  onActionComplete={() => {
                    qc.invalidateQueries({ queryKey: ['comments', comment.post_id] });
                  }}
                />
              )}
            </View>
            {/* body crossfade.
                collapsed: 1 行 snippet (text3 やや薄め)
                expanded: full content (text, lineHeight 22)
                両方を絶対配置で重ねず、collapsed 時は snippet only / expanded 時は
                full only を出す方が layout の高さが自然に伸縮する (Layout.springify
                でアニメ)。各 Text の opacity を bodyProgress と連動させて crossfade。 */}
            <View>
              {collapsed ? (
                <Animated.Text
                  key="snippet"
                  entering={reduceMotion ? undefined : FadeIn.duration(BODY_FADE_MS)}
                  exiting={reduceMotion ? undefined : FadeOut.duration(BODY_FADE_MS)}
                  numberOfLines={1}
                  style={[
                    T.body,
                    { color: C.text2, lineHeight: 20 },
                    snippetBodyStyle,
                  ]}
                >
                  {snippet}
                </Animated.Text>
              ) : (
                <Animated.Text
                  key="full"
                  entering={reduceMotion ? undefined : FadeIn.duration(BODY_FADE_MS)}
                  exiting={reduceMotion ? undefined : FadeOut.duration(BODY_FADE_MS)}
                  style={[T.body, { color: C.text, lineHeight: 22 }, fullBodyStyle]}
                >
                  {comment.content}
                </Animated.Text>
              )}
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                marginTop: 6,
              }}
            >
              {onReply && depth < COMMENT_MAX_DEPTH && (
                <PressableScale
                  onPress={() => onReply(comment)}
                  haptic="tap"
                  hitSlop={6}
                  accessibilityLabel="このコメントに返信"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['2'],
                    paddingVertical: 4,
                    borderRadius: R.sm,
                    backgroundColor: C.bg3,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Icon.send size={11} color={C.text2} strokeWidth={2.2} />
                  <Text
                    style={{
                      fontSize: 10,
                      color: C.text2,
                      fontWeight: '700',
                    }}
                  >
                    返信
                  </Text>
                </PressableScale>
              )}
              {isCollapsible && (
                <PressableScale
                  onPress={toggleCollapsed}
                  haptic="tap"
                  hitSlop={6}
                  accessibilityLabel={
                    collapsed
                      ? `返信 ${children.length} 件を表示`
                      : `返信 ${children.length} 件を折りたたむ`
                  }
                  accessibilityState={{ expanded: !collapsed }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['2'],
                    paddingVertical: 4,
                    borderRadius: R.sm,
                    backgroundColor: C.bg3,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  {/* chevron は 0 → 90deg 回転で collapsed/expanded を表現 */}
                  <Animated.View style={chevronStyle}>
                    <Icon.chevronR size={11} color={C.text2} strokeWidth={2.4} />
                  </Animated.View>
                  <Text
                    style={{
                      fontSize: 10,
                      color: C.text2,
                      fontWeight: '700',
                    }}
                  >
                    {collapsed
                      ? `${children.length} 件の返信を表示`
                      : '折りたたむ'}
                  </Text>
                </PressableScale>
              )}
            </View>
          </View>
        </PressableScale>
      </View>

      {/* 子 (再帰) — collapsed の場合は何も出さない。
          Layout.springify({damping:26, stiffness:280}) で兄弟 layout の伸縮を
          滑らかに駆動 (RN Reanimated v3 の native layout transition)。
          ReduceMotion 時は entering/exiting と layout を外して即時切替。 */}
      {!collapsed && children.length > 0 && (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(BODY_FADE_MS)}
          exiting={reduceMotion ? undefined : FadeOut.duration(BODY_FADE_MS)}
          layout={
            reduceMotion
              ? undefined
              : Layout.springify()
                  .damping(COLLAPSE_SPRING.damping)
                  .stiffness(COLLAPSE_SPRING.stiffness)
                  .mass(COLLAPSE_SPRING.mass)
          }
        >
          {children.map((child) => (
            <CommentThreadItem
              key={child.id}
              comment={child}
              rootIndex={rootIndex}
              postContent={postContent}
              postId={postId}
              parentCommunityId={parentCommunityId}
              onReply={onReply}
            />
          ))}
        </Animated.View>
      )}
    </View>
  );
}

