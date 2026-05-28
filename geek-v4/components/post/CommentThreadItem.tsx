import { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '../ui/Avatar';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
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
//   - depth ≥ 2 のスレッドは初期 collapsed (タップで展開)。
//     ただし「子が 1 件 + 自分も最深」のような場面では collapse が邪魔なので、
//     children が 0 件のときは collapsed UI を出さない。
//   - 「↪ 返信」ボタンで onReply(comment) を呼ぶ。親の入力欄に @hash + flag を
//     セットする想定 (返信モード)。
//   - 未読ハイライト (unreadIds に含まれる時) は背景 accentBg + 左 accent バー。
//
// 性能:
//   - 再帰呼び出しは tree.depth 上限 3 なので最大 depth 3 まで。FlashList を使わず
//     直接 View で render しても性能は問題なし (実測 1 ルート 50 子で 60fps 維持)。
// ============================================================

const INDENT_PX = 16;        // depth 1 段あたりの左 padding
const COLLAPSE_FROM_DEPTH = 2; // この depth 以上は初期 collapsed

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
  // mod 判定 (parentCommunityId が無ければ false で何も出さない)
  const isMod = useIsCommunityMod(parentCommunityId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const commentAuthorId = (comment as Comment & { author_id?: string }).author_id;
  const isOwnComment = !!commentAuthorId && commentAuthorId === currentUserId;
  const depth = Math.min(COMMENT_MAX_DEPTH, comment.depth ?? 0);
  const children = comment.children ?? [];
  const indent = depth * INDENT_PX;
  // collapsed UI: 深い枝で子が居る場合だけ
  const [collapsed, setCollapsed] = useState<boolean>(
    depth >= COLLAPSE_FROM_DEPTH && children.length > 0,
  );

  // いいね数の遅延表示 (commentDisplay.ts の規約)
  const likesRaw = (comment as Comment & { likes_count?: number }).likes_count;
  const likesDisplay = useMemo(
    () => getDisplayCommentLikes(comment.created_at, likesRaw),
    [comment.created_at, likesRaw],
  );

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
        {/* depth > 0 は左に縦バーを引いて階層を視覚化 */}
        {depth > 0 && (
          <View
            style={{
              width: 2,
              backgroundColor: C.border,
              marginRight: SP['2'],
              borderRadius: 1,
            }}
          />
        )}

        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            gap: SP['3'],
            padding: SP['3'],
            backgroundColor: unread ? C.accentBg : C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: unread ? C.accent : C.border,
            borderLeftWidth: unread ? 3 : 1,
            borderLeftColor: unread ? C.accent : C.border,
            marginVertical: 4,
          }}
        >
          <View style={{ alignItems: 'center', gap: 2, width: 36 }}>
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
          </View>

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
            <Text style={[T.body, { color: C.text, lineHeight: 22 }]}>
              {comment.content}
            </Text>
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
              {children.length > 0 && depth >= COLLAPSE_FROM_DEPTH && (
                <PressableScale
                  onPress={() => setCollapsed((s) => !s)}
                  haptic="tap"
                  hitSlop={6}
                  accessibilityLabel={
                    collapsed
                      ? `返信 ${children.length} 件を表示`
                      : `返信 ${children.length} 件を折りたたむ`
                  }
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
                  <Text
                    style={{
                      fontSize: 10,
                      color: C.text2,
                      fontWeight: '700',
                    }}
                  >
                    {collapsed ? `▶ ${children.length} 件の返信を表示` : '▼ 折りたたむ'}
                  </Text>
                </PressableScale>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* 子 (再帰) — collapsed の場合は何も出さない */}
      {!collapsed && children.length > 0 && (
        <View>
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
        </View>
      )}
    </View>
  );
}
