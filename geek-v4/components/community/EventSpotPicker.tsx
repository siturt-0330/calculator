// ============================================================
// EventSpotPicker — イベント作成時に会場 spot を選ぶ UI
// ------------------------------------------------------------
// migration 0046 で community_events.spot_id を追加したことに伴う UI。
// このコミュ内の community_spots を取得し、カード式リストから 1 件選択。
//
// 設計:
//   - 「会場なし (location_text のみ)」を default で残す (既存 UX 維持)
//   - 開閉式の panel (折りたたみ可) — 場所選びを必須化しない
//   - カテゴリ色 + emoji で視覚的に分かりやすく
//   - 「+ 新しい聖地を追加」ボタンで spot 作成画面に飛べる (戻ってきたら最新が反映)
// ============================================================
import { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import {
  fetchCommunitySpots,
  SPOT_CATEGORY_META,
  type SpotCategory,
} from '../../lib/api/communities';

export function EventSpotPicker({
  communityId,
  value,
  onChange,
}: {
  communityId: string;
  value: string | null;
  onChange: (spotId: string | null) => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<boolean>(value !== null);

  const { data: spots = [], isLoading } = useQuery({
    queryKey: ['community', communityId, 'spots'],
    queryFn: () => fetchCommunitySpots(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  const selected = value ? spots.find((s) => s.id === value) ?? null : null;
  const selectedMeta = selected
    ? SPOT_CATEGORY_META[(selected.category as SpotCategory) ?? 'other']
    : null;

  return (
    <View style={{ gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon.shield size={14} color={C.text2} strokeWidth={2.2} />
        <Text style={[T.small, { color: C.text2, fontWeight: '700', flex: 1 }]}>
          会場 (任意)
        </Text>
        <PressableScale
          onPress={() => setExpanded((v) => !v)}
          haptic="tap"
          hitSlop={6}
          style={{ paddingHorizontal: SP['2'], paddingVertical: 2 }}
        >
          <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
            {expanded ? '閉じる' : selected ? '変更' : '聖地から選ぶ'}
          </Text>
        </PressableScale>
      </View>

      {/* 選択中の表示 (collapsed 状態でも見せる) */}
      {selected && !expanded && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
            padding: SP['3'],
            backgroundColor: (selectedMeta?.color ?? C.accent) + '22',
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: (selectedMeta?.color ?? C.accent) + '55',
          }}
        >
          {/* 旧版は category 絵文字 prefix。装飾感を抑え color dot に置換。 */}
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: selectedMeta?.color ?? C.accent,
              marginRight: 4,
              alignSelf: 'center',
            }}
          />
          <View style={{ flex: 1 }}>
            <Text style={[T.smallB, { color: C.text }]} numberOfLines={1}>
              {selected.name}
            </Text>
            <Text style={{ fontSize: 11, color: selectedMeta?.color ?? C.text3, fontWeight: '700' }}>
              {selectedMeta?.label ?? 'その他'}
            </Text>
          </View>
          <PressableScale
            onPress={() => onChange(null)}
            haptic="tap"
            hitSlop={6}
            accessibilityLabel="会場を外す"
            style={{ padding: 4 }}
          >
            <Icon.close size={14} color={C.text3} strokeWidth={2.2} />
          </PressableScale>
        </View>
      )}

      {expanded && (
        <View
          style={{
            padding: SP['2'],
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
          }}
        >
          {/* なし */}
          <SpotChoice
            label="会場なし (テキストのみ)"
            color={C.text3}
            selected={value === null}
            onPress={() => onChange(null)}
          />

          {isLoading ? (
            <Text style={[T.caption, { color: C.text3, padding: SP['2'] }]}>
              聖地を読み込み中…
            </Text>
          ) : spots.length === 0 ? (
            <View style={{ padding: SP['2'], gap: SP['2'] }}>
              <Text style={[T.caption, { color: C.text3 }]}>
                このコミュニティにはまだ聖地が登録されていません。
              </Text>
              <PressableScale
                onPress={() => router.push(`/community/${communityId}/spot/create` as never)}
                haptic="tap"
                style={{
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: SP['3'],
                  paddingVertical: 6,
                  backgroundColor: C.accentBg,
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: C.accentSoft,
                }}
              >
                <Icon.plus size={12} color={C.accent} strokeWidth={2.4} />
                <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
                  新しい聖地を追加
                </Text>
              </PressableScale>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
              <View style={{ gap: SP['1'] }}>
                {spots.map((s) => {
                  const meta = SPOT_CATEGORY_META[(s.category as SpotCategory) ?? 'other'];
                  return (
                    <SpotChoice
                      key={s.id}
                      label={s.name}
                      color={meta.color}
                      categoryLabel={meta.label}
                      selected={value === s.id}
                      onPress={() => onChange(s.id)}
                    />
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* 追加導線 (常に出す — spot が増えるシナリオ) */}
          {spots.length > 0 && (
            <PressableScale
              onPress={() => router.push(`/community/${communityId}/spot/create` as never)}
              haptic="tap"
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                marginTop: SP['1'],
                backgroundColor: C.bg3,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Icon.plus size={12} color={C.text2} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
                ここに無ければ追加
              </Text>
            </PressableScale>
          )}
        </View>
      )}
    </View>
  );
}

function SpotChoice({
  label,
  color,
  categoryLabel,
  selected,
  onPress,
}: {
  label: string;
  color: string;
  categoryLabel?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        padding: SP['2'],
        backgroundColor: selected ? color + '33' : 'transparent',
        borderRadius: R.md,
        borderWidth: 1.5,
        borderColor: selected ? color : C.border,
      }}
    >
      {/* 旧版は 28x28 円の中に category 絵文字を載せていたが、AI 装飾感を抑える
          ため category color の単純な dot に置換。 */}
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: color,
          marginLeft: 4,
          marginRight: 2,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={[T.smallM, { color: selected ? color : C.text, fontWeight: '700' }]} numberOfLines={1}>
          {label}
        </Text>
        {categoryLabel && (
          <Text style={{ fontSize: 11, color: selected ? color : C.text3, fontWeight: '600' }}>
            {categoryLabel}
          </Text>
        )}
      </View>
      {selected && <Icon.check size={14} color={color} strokeWidth={2.6} />}
    </PressableScale>
  );
}
