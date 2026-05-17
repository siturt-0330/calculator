import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

type Activity = {
  post_count_7d: number;
  comment_count_7d: number;
  bbs_reply_count_7d: number;
  likes_received_7d: number;
  reactions_received_7d: number;
  active_days_7d: number;
};

async function fetchActivity(userId: string): Promise<Activity> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [posts, comments, bbsReplies, likes, reactions] = await Promise.all([
    supabase.from('posts')
      .select('id, created_at', { count: 'exact', head: false })
      .eq('author_id', userId)
      .gte('created_at', since),
    supabase.from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', userId)
      .gte('created_at', since),
    supabase.from('bbs_replies')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', userId)
      .gte('created_at', since),
    supabase.from('likes')
      .select('post_id, posts!inner(author_id)', { count: 'exact', head: true })
      .eq('posts.author_id', userId)
      .gte('created_at', since),
    supabase.from('post_reactions')
      .select('post_id, posts!inner(author_id)', { count: 'exact', head: true })
      .eq('posts.author_id', userId)
      .gte('created_at', since),
  ]);

  // active days: 自分の投稿/コメント/BBS返信が異なる日付に分散している数
  const days = new Set<string>();
  for (const p of (posts.data ?? []) as Array<{ created_at: string }>) {
    days.add(p.created_at.slice(0, 10));
  }

  return {
    post_count_7d: posts.count ?? 0,
    comment_count_7d: comments.count ?? 0,
    bbs_reply_count_7d: bbsReplies.count ?? 0,
    likes_received_7d: likes.count ?? 0,
    reactions_received_7d: reactions.count ?? 0,
    active_days_7d: days.size,
  };
}

export function ActivitySummary() {
  const userId = useAuthStore((s) => s.user?.id);

  const { data: activity } = useQuery({
    queryKey: ['activity-summary', userId],
    queryFn: () => fetchActivity(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  // 「報われ度」: もらった反応 vs 自分の投稿
  const rewardRatio = useMemo(() => {
    if (!activity) return 0;
    const acts = activity.post_count_7d + activity.comment_count_7d + activity.bbs_reply_count_7d;
    if (acts === 0) return 0;
    const got = activity.likes_received_7d + activity.reactions_received_7d;
    return Math.round((got / acts) * 10) / 10;
  }, [activity]);

  if (!userId) return null;

  return (
    <View style={{
      marginHorizontal: SP['4'],
      marginTop: SP['5'],
      backgroundColor: C.bg2,
      borderRadius: R.xl,
      borderWidth: 1,
      borderColor: C.border,
      padding: SP['4'],
      gap: SP['3'],
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 18 }}>📊</Text>
        <Text style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}>
          今週の活動
        </Text>
        <Text style={[T.caption, { color: C.text3 }]}>過去7日</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Stat label="投稿" value={activity?.post_count_7d ?? 0} emoji="📝" />
        <Stat label="コメント" value={activity?.comment_count_7d ?? 0} emoji="💬" />
        <Stat label="掲示板返信" value={activity?.bbs_reply_count_7d ?? 0} emoji="💭" />
        <Stat label="アクティブ日" value={activity?.active_days_7d ?? 0} emoji="🌟" suffix="日" />
        <Stat label="もらったいいね" value={activity?.likes_received_7d ?? 0} emoji="💛" />
        <Stat label="もらったリアクション" value={activity?.reactions_received_7d ?? 0} emoji="🪶" />
      </View>
      {activity && (activity.post_count_7d + activity.comment_count_7d) > 0 && (
        <View style={{
          padding: SP['2'],
          backgroundColor: rewardRatio >= 2 ? 'rgba(34,211,164,0.13)' : C.bg3,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: rewardRatio >= 2 ? 'rgba(34,211,164,0.4)' : C.border,
        }}>
          <Text style={[T.caption, { color: rewardRatio >= 2 ? '#22D3A4' : C.text2 }]}>
            ✨ 報われ度 <Text style={{ fontWeight: '700' }}>{rewardRatio}</Text> 反応/活動
            {rewardRatio >= 2 ? ' — 共感が多く返ってきています！' : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

function Stat({
  label, value, emoji, suffix,
}: { label: string; value: number; emoji: string; suffix?: string }) {
  return (
    <View style={{
      width: '33.33%',
      alignItems: 'center',
      paddingVertical: SP['2'],
      gap: 2,
    }}>
      <Text style={{ fontSize: 14 }}>{emoji}</Text>
      <Text style={[T.h4, { color: C.text, fontWeight: '700' }]}>
        {value.toLocaleString()}{suffix ?? ''}
      </Text>
      <Text style={[T.caption, { color: C.text3, fontSize: 9, textAlign: 'center' }]}>{label}</Text>
    </View>
  );
}
