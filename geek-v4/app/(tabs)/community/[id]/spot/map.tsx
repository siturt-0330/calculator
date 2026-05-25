// ============================================================
// 聖地マップビュー — community_spots を カテゴリ色分け pin で一覧表示
// ------------------------------------------------------------
// Native: react-native-maps の Marker で SPOT_CATEGORY_META.color を pinColor に
// Web: react-native-maps の Web 対応は限定的なので、Leaflet iframe + 簡易リスト
//      (リスト側の色付き chip + tap → 編集画面 / Google Maps 起動) で代替
//
// 機能:
//   - カテゴリ filter chip (toggle で表示/非表示)
//   - pin tap → 聖地詳細 (edit 画面へ遷移)
//   - 「+ 聖地を追加」ボタン (右下 FAB)
//
// パス: /community/[id]/spot/map
// ============================================================

import { View, Text, ScrollView, Platform } from 'react-native';
import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../../../design/tokens';
import { T } from '../../../../../design/typography';
import { BackButton } from '../../../../../components/nav/BackButton';
import { PressableScale } from '../../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../../components/ui/EmptyState';
import { Spinner } from '../../../../../components/ui/Spinner';
import { Icon } from '../../../../../constants/icons';
import {
  fetchCommunitySpots,
  fetchCommunity,
  SELECTABLE_SPOT_CATEGORIES,
  SPOT_CATEGORY_META,
  type CommunitySpot,
  type SpotCategory,
} from '../../../../../lib/api/communities';
import { TABBAR } from '../../../../../design/tabbar';
import { safeOpenUrl } from '../../../../../lib/openUrl';

const TOKYO: { lat: number; lon: number } = { lat: 35.681236, lon: 139.767125 };

export default function SpotMapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';

  const { data: community } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });
  const { data: spots = [], isLoading } = useQuery({
    queryKey: ['community', id, 'spots'],
    queryFn: () => fetchCommunitySpots(id),
    enabled: id.length > 0,
    staleTime: 30_000,
  });

  // カテゴリ filter — 全カテゴリ on を default に
  const [enabledCats, setEnabledCats] = useState<Set<SpotCategory>>(
    () => new Set(SELECTABLE_SPOT_CATEGORIES),
  );
  const visibleSpots = useMemo(
    () => spots.filter((s) => enabledCats.has(s.category as SpotCategory)),
    [spots, enabledCats],
  );

  // 件数 (カテゴリ別) — chip 横に数を出す
  const countByCat = useMemo(() => {
    const m = new Map<SpotCategory, number>();
    for (const s of spots) {
      const c = s.category as SpotCategory;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [spots]);

  // マップ中心: 最初の visible spot or 東京駅
  const center = visibleSpots[0] ?? null;
  const canCreate = !!community?.is_member;

  const toggleCat = (c: SpotCategory) => {
    setEnabledCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>聖地マップ</Text>
        <Text style={[T.caption, { color: C.text3 }]}>
          {visibleSpots.length}/{spots.length}
        </Text>
      </View>

      {/* カテゴリ filter chip 列 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingVertical: SP['2'],
          gap: SP['2'],
        }}
      >
        {SELECTABLE_SPOT_CATEGORIES.map((c) => {
          const meta = SPOT_CATEGORY_META[c];
          const on = enabledCats.has(c);
          const count = countByCat.get(c) ?? 0;
          return (
            <PressableScale
              key={c}
              onPress={() => toggleCat(c)}
              haptic="select"
              hitSlop={4}
              accessibilityLabel={`${meta.label} ${on ? '非表示' : '表示'}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                borderRadius: R.full,
                backgroundColor: on ? meta.color + '33' : C.bg3,
                borderWidth: 1.5,
                borderColor: on ? meta.color : C.border,
                opacity: count === 0 ? 0.4 : 1,
              }}
            >
              <Text style={{ fontSize: 14 }}>{meta.emoji}</Text>
              <Text
                style={{
                  fontSize: 12,
                  color: on ? meta.color : C.text2,
                  fontWeight: '700',
                }}
              >
                {meta.label}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  color: on ? meta.color : C.text3,
                  fontWeight: '600',
                }}
              >
                {count}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* Map 本体 (Native) / iframe + リスト (Web) */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size="large" />
        </View>
      ) : spots.length === 0 ? (
        <View style={{ flex: 1, padding: SP['4'] }}>
          <EmptyState
            icon={Icon.map}
            title="まだ聖地がありません"
            message={canCreate ? '右下の + ボタンから追加できます' : 'メンバーが追加するのを待ちましょう'}
            tone="green"
          />
        </View>
      ) : Platform.OS === 'web' ? (
        <WebSpotMap
          spots={visibleSpots}
          center={center}
          onSpotPress={(s) => router.push(`/community/${id}/spot/${s.id}/edit` as never)}
        />
      ) : (
        <NativeSpotMap
          spots={visibleSpots}
          center={center}
          onSpotPress={(s) => router.push(`/community/${id}/spot/${s.id}/edit` as never)}
        />
      )}

      {/* FAB: 聖地を追加 */}
      {canCreate && (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', right: SP['4'], bottom: insets.bottom + TABBAR.height + SP['3'] }}
        >
          <PressableScale
            onPress={() => router.push(`/community/${id}/spot/create` as never)}
            haptic="confirm"
            scaleValue={0.92}
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: C.accent,
              alignItems: 'center',
              justifyContent: 'center',
              ...SHADOW.accentGlow,
            }}
            accessibilityLabel="聖地を追加"
          >
            <Icon.plus size={24} color="#fff" strokeWidth={2.6} />
          </PressableScale>
        </View>
      )}
    </View>
  );
}

// ============================================================
// Native: react-native-maps の Marker (eval-require で Web bundle から外す)
// ============================================================
function NativeSpotMap({
  spots,
  center,
  onSpotPress,
}: {
  spots: CommunitySpot[];
  center: CommunitySpot | null;
  onSpotPress: (s: CommunitySpot) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const dynRequire = new Function('mod', 'return require(mod)') as (m: string) => unknown;
  let MapView: React.ComponentType<Record<string, unknown>> | null = null;
  let Marker: React.ComponentType<Record<string, unknown>> | null = null;
  try {
    const mod = dynRequire('react-native-maps') as { default?: unknown; MapView?: unknown; Marker?: unknown };
    MapView = (mod.default ?? mod.MapView) as React.ComponentType<Record<string, unknown>>;
    Marker = mod.Marker as React.ComponentType<Record<string, unknown>>;
  } catch {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP['4'] }}>
        <Text style={[T.body, { color: C.text2 }]}>マップを読み込めませんでした</Text>
      </View>
    );
  }
  if (!MapView || !Marker) return null;
  const c = center ?? { lat: TOKYO.lat, lon: TOKYO.lon } as CommunitySpot;
  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={{
          latitude: c.lat,
          longitude: c.lon,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {spots.map((s) => {
          const meta = SPOT_CATEGORY_META[s.category as SpotCategory];
          return (
            <Marker
              key={s.id}
              coordinate={{ latitude: s.lat, longitude: s.lon }}
              title={s.name}
              description={meta.label}
              pinColor={meta.color}
              onPress={() => onSpotPress(s)}
            />
          );
        })}
      </MapView>
    </View>
  );
}

// ============================================================
// Web: OSM iframe で 1 spot だけ + 下に カテゴリ色付き list
// ------------------------------------------------------------
// 複数ピンの iframe は OSM の embed API では難しいので、リスト中心の UX に
// する。Google Maps を開きたい時は spot ごとの「Maps で開く」リンク。
// ============================================================
function WebSpotMap({
  spots,
  center,
  onSpotPress,
}: {
  spots: CommunitySpot[];
  center: CommunitySpot | null;
  onSpotPress: (s: CommunitySpot) => void;
}) {
  const c = center ?? null;
  const bbox = c
    ? `${c.lon - 0.02}%2C${c.lat - 0.02}%2C${c.lon + 0.02}%2C${c.lat + 0.02}`
    : '139.74%2C35.66%2C139.79%2C35.70';
  const src = c
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${c.lat}%2C${c.lon}`
    : `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: SP['12'] }}>
      <View
        style={{
          height: 280,
          marginHorizontal: SP['4'],
          marginTop: SP['2'],
          borderRadius: R.lg,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {React.createElement('iframe' as any, {
          src,
          style: { border: 0, width: '100%', height: '100%' },
          loading: 'lazy',
          title: 'spot-map',
          sandbox: 'allow-scripts allow-same-origin allow-popups',
          referrerPolicy: 'no-referrer',
        })}
      </View>
      <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], gap: SP['2'] }}>
        {spots.map((s) => {
          const meta = SPOT_CATEGORY_META[s.category as SpotCategory];
          return (
            <PressableScale
              key={s.id}
              onPress={() => onSpotPress(s)}
              haptic="tap"
              style={{
                flexDirection: 'row',
                gap: SP['2'],
                alignItems: 'center',
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: meta.color + '55',
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: meta.color + '33',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: meta.color,
                }}
              >
                <Text style={{ fontSize: 16 }}>{meta.emoji}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={{ fontSize: 11, color: meta.color, fontWeight: '700' }}>
                  {meta.label}
                </Text>
              </View>
              <PressableScale
                onPress={() =>
                  safeOpenUrl(
                    `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`,
                    { errorMessage: 'マップを開けませんでした' },
                  )
                }
                haptic="tap"
                hitSlop={6}
                style={{
                  padding: 6,
                  borderRadius: R.full,
                  backgroundColor: C.bg3,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Icon.map size={14} color={C.text2} strokeWidth={2.2} />
              </PressableScale>
            </PressableScale>
          );
        })}
      </View>
    </ScrollView>
  );
}

// React.createElement で iframe を出すための named import (Web のみ用)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const React = require('react') as typeof import('react');
