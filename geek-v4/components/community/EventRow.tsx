import { View, Text } from 'react-native';
import { Icon } from '../../constants/icons';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import type { CommunityEvent } from '../../lib/api/communities';

// ============================================================
// EventRow — コミュニティ詳細画面で 1 件のイベントを表示するロー
// ============================================================
// 元は app/(tabs)/community/[id]/index.tsx 内に定義されていたが、
// ファイルが 2000 行近くまで肥大化していたため切り出した。
// 表示専用 (state なし) — props で受け取った event を render するだけ。
// ============================================================
export function EventRow({ event }: { event: CommunityEvent }) {
  const d = new Date(event.starts_at);
  const valid = !Number.isNaN(d.getTime());
  const day = valid ? d.getDate() : '?';
  const weekday = valid
    ? ['日', '月', '火', '水', '木', '金', '土'][d.getDay()] ?? ''
    : '';
  const time = valid
    ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    : '';
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: SP['3'],
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <View
        style={{
          width: 56,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: C.bg3,
          borderRadius: R.md,
          paddingVertical: SP['2'],
        }}
      >
        <Text style={[T.numLg, { color: C.text }]}>{day}</Text>
        <Text style={[T.caption, { color: C.text3 }]}>{weekday}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[T.bodyB, { color: C.text }]} numberOfLines={2}>
          {event.title}
        </Text>
        <Text style={[T.caption, { color: C.text3 }]}>{time}</Text>
        {event.location_text && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon.map size={12} color={C.text3} strokeWidth={2.2} />
            <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>
              {event.location_text}
            </Text>
          </View>
        )}
        {event.description.length > 0 && (
          <Text style={[T.small, { color: C.text2 }]} numberOfLines={3}>
            {event.description}
          </Text>
        )}
      </View>
    </View>
  );
}
