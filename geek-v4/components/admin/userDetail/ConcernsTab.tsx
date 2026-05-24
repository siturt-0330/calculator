// ============================================================
// userDetail/ConcernsTab — admin/user/[id] の Tab 2 (通報履歴)
// ============================================================
// 1 投稿に複数 reporter が付いた場合は post 単位でグルーピング。
// reporter は匿名 Avatar + ID slice + reason chip で表示。
// ============================================================
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { Avatar } from '../../ui/Avatar';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { formatRelative } from '../../../lib/utils/date';
import type { AdminPost, ConcernSummary } from '../../../lib/api/admin';
import { UserDetailEmptyState } from './_shared';

export function ConcernsTab({ concerns, posts }: { concerns: ConcernSummary[]; posts: AdminPost[] }) {
  const postMap = useMemo(() => {
    const m = new Map<string, AdminPost>();
    for (const p of posts) m.set(p.id, p);
    return m;
  }, [posts]);

  // 投稿単位でグルーピング — 1 つの投稿が複数人から通報される時の繰返しを抑える
  const grouped = useMemo(() => {
    const map = new Map<string, { post_id: string; reporters: ConcernSummary[] }>();
    for (const c of concerns) {
      const existing = map.get(c.post_id);
      if (existing) {
        existing.reporters.push(c);
      } else {
        map.set(c.post_id, { post_id: c.post_id, reporters: [c] });
      }
    }
    return Array.from(map.values());
  }, [concerns]);

  if (grouped.length === 0) {
    return <UserDetailEmptyState icon="🕊️" title="通報されていません" hint="この期間の通報は見つかりません" />;
  }

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
      {grouped.map((g, i) => {
        const post = postMap.get(g.post_id);
        return (
          <Animated.View
            key={g.post_id}
            entering={FadeInDown.duration(220).delay(i * 20)}
            layout={Layout.springify()}
            style={[{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }, SHADOW.card]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <View
                style={{
                  paddingHorizontal: SP['2'], paddingVertical: 2,
                  backgroundColor: C.redBg, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.red + '55',
                }}
              >
                <Text style={{ fontSize: 10, color: C.red, fontWeight: '800' }}>
                  🚩 {g.reporters.length} 件
                </Text>
              </View>
              <Text style={[T.captionM, { color: C.text3, flex: 1 }]} numberOfLines={1}>
                投稿 {g.post_id.slice(0, 8)}
              </Text>
            </View>
            <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={2}>
              {post?.content || '(本文を取得できませんでした)'}
            </Text>
            <View
              style={{
                gap: 6, paddingTop: SP['2'],
                borderTopWidth: 1, borderTopColor: C.divider,
              }}
            >
              {g.reporters.map((r, idx) => (
                <View
                  key={`${r.user_id}-${idx}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}
                >
                  <Avatar size={24} anonymous name={r.user_id} />
                  <Text style={[T.mono, { color: C.text2, fontSize: 11, flex: 1 }]} numberOfLines={1}>
                    {r.user_id.slice(0, 8)}
                  </Text>
                  {r.reason && (
                    <View
                      style={{
                        paddingHorizontal: SP['2'], paddingVertical: 1,
                        backgroundColor: C.bg3, borderRadius: R.full,
                        borderWidth: 1, borderColor: C.border,
                      }}
                    >
                      <Text style={[T.caption, { color: C.text2, fontSize: 10 }]} numberOfLines={1}>
                        {r.reason}
                      </Text>
                    </View>
                  )}
                  <Text style={[T.caption, { color: C.text4, fontSize: 10 }]}>
                    {formatRelative(r.created_at)}
                  </Text>
                </View>
              ))}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
