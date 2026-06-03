// ============================================================
// SupportThreadCard — Modmail 一覧の 1 行カード
// ============================================================
// GlassCard ベース。
//   - subject (T.bodyMd)
//   - category chip (色付き emoji + label)
//   - state badge (未対応 / 対応中 / 解決済)
//   - last_message_at (T.caption C.text3)
//   - unread badge (red dot or count pill)
// admin 画面では author nickname も表示する (showAuthor=true)。
// ============================================================
import { View, Text } from 'react-native';
import { GlassCard } from '../ui/GlassCard';
import { PressableScale } from '../ui/PressableScale';
import { CATEGORY_META, STATE_META, type SupportThread } from '../../lib/api/support';
import { formatRelative } from '../../lib/utils/date';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

type Props = {
  thread: SupportThread;
  /** admin 画面で表示する author 名 (user 画面では undefined) */
  authorNickname?: string | null;
  /** 「自分側 (user)」視点 で unread を見るか / 「admin 側」視点で見るか */
  asAdmin?: boolean;
  onPress: () => void;
};

// state 表示用色
const STATE_COLORS: Record<'amber' | 'accent' | 'text3', { fg: string; bg: string; border: string }> = {
  amber: { fg: C.amber, bg: C.amberBg, border: C.amber + '55' },
  accent: { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  text3: { fg: C.text3, bg: C.bg3, border: C.border },
};

export function SupportThreadCard({ thread, authorNickname, asAdmin = false, onPress }: Props) {
  const cat = CATEGORY_META[thread.category];
  const stateMeta = STATE_META[thread.state];
  const stateC = STATE_COLORS[stateMeta.color];
  const unread = asAdmin ? thread.unread_count_for_admin : thread.unread_count_for_user;
  const hasUnread = unread > 0;

  return (
    <PressableScale onPress={onPress} haptic="tap" style={{ marginBottom: SP['2'] }}>
      <GlassCard
        style={[
          {
            // accent border を unread 状態のとき軽く強調
            borderColor: hasUnread ? C.accent + '55' : C.glassBorder,
            gap: SP['2'],
          },
          hasUnread ? SHADOW.sm : null,
        ]}
      >
        {/* 1 段目: subject + state badge */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP['2'] }}>
          <Text style={[T.bodyMd, { color: C.text, flex: 1 }]} numberOfLines={1}>
            {thread.subject}
          </Text>
          <View
            style={{
              paddingHorizontal: SP['2'],
              paddingVertical: 2,
              borderRadius: R.sm,
              backgroundColor: stateC.bg,
              borderWidth: 1,
              borderColor: stateC.border,
            }}
          >
            <Text style={{ fontSize: 10, color: stateC.fg, fontWeight: '700' }}>
              {stateMeta.label}
            </Text>
          </View>
        </View>

        {/* 2 段目: category chip + author (admin 画面) + last_message_at + unread */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
          {/* category chip — emoji + label */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: SP['2'],
              paddingVertical: 2,
              borderRadius: R.full,
              backgroundColor: C.accentBg,
              borderWidth: 1,
              borderColor: C.accent + '44',
            }}
          >
            <Text style={{ fontSize: 11 }}>{cat.emoji}</Text>
            <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
              {cat.label}
            </Text>
          </View>

          {/* admin 画面のみ author nickname */}
          {authorNickname && (
            <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
              {authorNickname}
            </Text>
          )}

          <View style={{ flex: 1 }} />

          {/* last_message_at */}
          <Text style={[T.caption, { color: C.text3 }]}>
            {formatRelative(thread.last_message_at)}
          </Text>

          {/* unread badge */}
          {hasUnread && (
            <View
              style={{
                minWidth: 18,
                height: 18,
                paddingHorizontal: 5,
                borderRadius: R.full,
                backgroundColor: C.red,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                {unread > 9 ? '9+' : String(unread)}
              </Text>
            </View>
          )}
        </View>
      </GlassCard>
    </PressableScale>
  );
}
