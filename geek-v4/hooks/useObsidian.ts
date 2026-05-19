import { useEffect, useState, useCallback } from 'react';
import { isObsidianEnabled, saveToObsidian } from '@/lib/obsidian';
import type { Post } from '@/types/models';

// 連携 ON/OFF 状態を購読する軽量フック
// AsyncStorage は同期取れないので useEffect で初期 fetch、setObsidianEnabled 後は
// 自前で setState する想定 (settings 画面でのみ更新)
export function useObsidianEnabled(): { enabled: boolean; refresh: () => Promise<void> } {
  const [enabled, setEnabled] = useState(false);
  const refresh = useCallback(async () => {
    const e = await isObsidianEnabled();
    setEnabled(e);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { enabled, refresh };
}

// 投稿を Obsidian に保存するヘルパ (saveToObsidian の thin wrapper)
export async function savePostToObsidian(post: Post): Promise<{ ok: boolean; reason?: string }> {
  return saveToObsidian({
    id: post.id,
    content: post.content,
    tagNames: post.tag_names ?? undefined,
    createdAt: post.created_at,
    likesCount: post.likes_count ?? undefined,
    commentsCount: post.comments_count ?? undefined,
    sourceUrl: post.source_url ?? undefined,
    kind: post.kind ?? undefined,
    mediaUrls: post.media_urls ?? undefined,
  });
}
