import { useEffect, useState, useCallback } from 'react';
import { isObsidianEnabled, saveNoteToObsidian, OBSIDIAN_AVAILABLE, type ObsidianNote } from '../lib/obsidian';
import type { Post, BBSThread, BBSReply, Comment } from '../types/models';
import type { CommunityPostWithCommunity, Community } from '../lib/api/communities';

// 連携 ON/OFF 状態を購読する軽量フック
// 開発者専用フラグが false (production) なら常に enabled=false を返す
export function useObsidianEnabled(): { enabled: boolean; refresh: () => Promise<void> } {
  const [enabled, setEnabled] = useState(false);
  const refresh = useCallback(async () => {
    if (!OBSIDIAN_AVAILABLE) {
      setEnabled(false);
      return;
    }
    const e = await isObsidianEnabled();
    setEnabled(e);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { enabled, refresh };
}

// ============================================================
// 各エンティティ → ObsidianNote への変換ヘルパ
// ============================================================

export function postToObsidianNote(post: Post): ObsidianNote {
  return {
    id: post.id,
    type: 'post',
    content: post.content,
    tagNames: post.tag_names ?? undefined,
    createdAt: post.created_at,
    likesCount: post.likes_count ?? undefined,
    commentsCount: post.comments_count ?? undefined,
    sourceUrl: post.source_url ?? undefined,
    kind: post.kind ?? undefined,
    mediaUrls: post.media_urls ?? undefined,
  };
}

export function communityPostToObsidianNote(
  p: CommunityPostWithCommunity,
): ObsidianNote {
  return {
    id: p.id,
    type: 'community_post',
    content: p.body,
    createdAt: p.created_at,
    communityName: p.community?.name,
    communityId: p.community?.id,
    authorNickname: p.author_nickname,
    mediaUrls: p.image_url ? [p.image_url] : undefined,
  };
}

export function communityToObsidianNote(c: Community): ObsidianNote {
  return {
    id: c.id,
    type: 'community',
    title: c.name,
    content: c.description || '(説明なし)',
    createdAt: c.created_at,
  };
}

export function bbsThreadToObsidianNote(t: BBSThread): ObsidianNote {
  return {
    id: t.id,
    type: 'bbs_thread',
    title: t.title,
    content: `カテゴリ: ${t.category}\n返信数: ${t.replies_count}`,
    createdAt: t.created_at,
  };
}

export function bbsReplyToObsidianNote(
  r: BBSReply,
  threadTitle?: string,
  threadId?: string,
): ObsidianNote {
  return {
    id: r.id,
    type: 'bbs_reply',
    content: r.content,
    createdAt: r.created_at,
    threadTitle,
    threadId,
  };
}

export function commentToObsidianNote(
  c: Comment,
  parentPostContent?: string,
  parentPostId?: string,
): ObsidianNote {
  return {
    id: c.id,
    type: 'comment',
    content: c.content,
    createdAt: c.created_at,
    parentPostContent,
    parentPostId,
  };
}

// ============================================================
// 後方互換
// ============================================================

export async function savePostToObsidian(post: Post): Promise<{ ok: boolean; reason?: string }> {
  return saveNoteToObsidian(postToObsidianNote(post));
}
