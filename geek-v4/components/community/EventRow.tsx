import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import {
  type CommunityEvent,
  type CommunitySpot,
  type SpotCategory,
  SPOT_CATEGORY_META,
} from '../../lib/api/communities';

// ============================================================
// EventRow — コミュニティ詳細画面で 1 件のイベントを表示するロー
// ============================================================
// 元は app/(tabs)/community/[id]/index.tsx 内に定義されていたが、
// ファイルが 2000 行近くまで肥大化していたため切り出した。
// 表示専用 (state なし) — props で受け取った event を render するだけ。
//
// migration 0046 で event.spot_id が追加 → spot 情報を親から渡せる場合は
// カテゴリ色付き badge を出し、tap で spot 詳細 (edit) に飛べる。
// ============================================================
export function EventRow({ event, spot }: { event: CommunityEvent; spot?: CommunitySpot | null }) {
  const router = useRouter();
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
        {/* spot リンク (migration 0046) — 会場 spot がある時は強調 */}
        {spot && (() => {
          const meta = SPOT_CATEGORY_META[(spot.category as SpotCategory) ?? 'other'];
          return (
            <PressableScale
              onPress={() =>
                router.push(`/community/${event.community_id}/spot/${spot.id}/edit` as never)
              }
              haptic="tap"
              hitSlop={4}
              accessibilityLabel={`会場「${spot.name}」を開く`}
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 4,
                backgroundColor: meta.color + '22',
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: meta.color + '55',
              }}
            >
              {/* 装飾絵文字 → color dot に統一 (event 会場 chip も同方針) */}
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: meta.color }} />
              <Text style={{ fontSize: 11, color: meta.color, fontWeight: '700' }} numberOfLines={1}>
                {spot.name}
              </Text>
              <Icon.chevronR size={10} color={meta.color} strokeWidth={2.4} />
            </PressableScale>
          );
        })()}
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
