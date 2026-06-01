import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Platform, ActivityIndicator, TextInput } from 'react-native';
import { safeOpenUrl } from '../../lib/openUrl';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { BackButton } from '../../components/nav/BackButton';
import { TopBar } from '../../components/nav/TopBar';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { distanceKm, fetchEventLocations, fetchTourismSpots, type MapLocation } from '../../lib/api/map';
import { useToastStore } from '../../stores/toastStore';

type Mode = 'event' | 'spot' | 'all';

const PRESET_AREAS: { name: string; lat: number; lng: number; emoji: string }[] = [
  { name: '東京',    lat: 35.6586, lng: 139.7454, emoji: '🗼' },
  { name: '渋谷',    lat: 35.6580, lng: 139.7016, emoji: '🚏' },
  { name: '池袋',    lat: 35.7295, lng: 139.7193, emoji: '🌸' },
  { name: '秋葉原',  lat: 35.6985, lng: 139.7728, emoji: '🎮' },
  { name: '横浜',    lat: 35.4660, lng: 139.6228, emoji: '🌉' },
  { name: '大阪',    lat: 34.6937, lng: 135.5023, emoji: '🏯' },
  { name: '京都',    lat: 35.0116, lng: 135.7681, emoji: '⛩️' },
  { name: '名古屋',  lat: 35.1815, lng: 136.9066, emoji: '🍤' },
  { name: '札幌',    lat: 43.0618, lng: 141.3545, emoji: '❄' },
  { name: '福岡',    lat: 33.5904, lng: 130.4017, emoji: '🍜' },
];

// Leaflet ベースのインタラクティブマップ HTML を生成
function buildLeafletHTML(opts: {
  centerLat: number;
  centerLng: number;
  zoom?: number;
  myLat: number | null;
  myLng: number | null;
  locations: { id: string; lat: number; lng: number; name: string; emoji: string; color: string; tag?: string | null; date?: string | null }[];
}): string {
  const { centerLat, centerLng, zoom = 13, myLat, myLng, locations } = opts;
  const locJson = JSON.stringify(locations);
  const myLoc = myLat !== null && myLng !== null ? `[${myLat}, ${myLng}]` : 'null';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<meta name="referrer" content="no-referrer" />
<!--
  CSP: WebView 内で任意 JS が実行できないよう発火面を限定。
  - script-src: 自分自身 + Leaflet/MarkerCluster の CDN (unpkg)。'unsafe-inline'
    が要るのは map 初期化用のインライン script (このファイル末尾) のため。
    DB 由来文字列は generateHtml 側で escapeHtml/safeColor/safeNum でサニタイズ済。
  - img-src: タイルサーバー (OSM) と data: のみ。
  - connect-src: タイル取得のみ。fetch/XHR で外部に流出させない。
  - frame-ancestors: 'none' (clickjacking 対策)
-->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com; connect-src 'self' https://*.tile.openstreetmap.org; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; background: #0a0a0a; font-family: -apple-system, system-ui, sans-serif; }
  .pin {
    position: relative;
    width: 32px; height: 42px;
    transform: translate(-16px, -42px);
  }
  .pin .head {
    width: 32px; height: 32px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 6px rgba(0,0,0,0.45);
    border: 2px solid white;
  }
  .pin .emoji {
    transform: rotate(45deg);
    font-size: 16px; line-height: 1;
  }
  .me-pin {
    width: 22px; height: 22px; border-radius: 50%;
    background: #3a8efd; border: 3px solid white;
    box-shadow: 0 0 0 4px rgba(58,142,253,0.3), 0 2px 5px rgba(0,0,0,0.5);
    animation: pulse 2s infinite ease-out;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(58,142,253,0.6); }
    100% { box-shadow: 0 0 0 18px rgba(58,142,253,0); }
  }
  .leaflet-popup-content-wrapper {
    background: #fff; border-radius: 12px; padding: 4px 0;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  }
  .leaflet-popup-content { margin: 12px 14px; min-width: 200px; }
  .pop-title { font-size: 14px; font-weight: 800; color: #111; margin-bottom: 4px; }
  .pop-addr  { font-size: 11px; color: #555; margin-bottom: 6px; line-height: 1.3; }
  .pop-tag   { font-size: 11px; color: #7C6AF7; font-weight: 700; }
  .pop-actions { margin-top: 8px; display: flex; gap: 6px; }
  .pop-btn {
    display: inline-block; padding: 5px 10px;
    background: #7C6AF7; color: #fff; text-decoration: none;
    border-radius: 6px; font-size: 11px; font-weight: 700;
  }
  .pop-btn.gmap { background: #4285f4; }
  .leaflet-control-attribution { font-size: 9px; }
  .marker-cluster-small { background: rgba(124,106,247,0.6); }
  .marker-cluster-small div { background: rgba(124,106,247,0.9); color: #fff; }
  .marker-cluster-medium { background: rgba(255,140,48,0.6); }
  .marker-cluster-medium div { background: rgba(255,140,48,0.9); color: #fff; }
  .marker-cluster-large { background: rgba(244,114,182,0.6); }
  .marker-cluster-large div { background: rgba(244,114,182,0.9); color: #fff; }
</style>
</head>
<body>
<div id="map"></div>
<script>
const map = L.map('map', { zoomControl: true, attributionControl: true })
  .setView([${centerLat}, ${centerLng}], ${zoom});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, minZoom: 5,
  attribution: '© OpenStreetMap',
}).addTo(map);

const myLoc = ${myLoc};
if (myLoc) {
  const meIcon = L.divIcon({ html: '<div class="me-pin"></div>', className: '', iconSize: [22, 22], iconAnchor: [11, 11] });
  L.marker(myLoc, { icon: meIcon }).addTo(map).bindPopup('現在地');
}

const locations = ${locJson};
// HTML エスケープ + CSS 値サニタイズ — popup HTML 生成時に DB 由来の文字列を
// 直接 innerHTML 経由で挿入するので、defense-in-depth で必須
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function safeColor(c) {
  // # + hex 6-8 桁 だけ通す
  if (typeof c !== 'string') return '#7C6AF7';
  return /^#[0-9a-fA-F]{6,8}$/.test(c) ? c : '#7C6AF7';
}
function safeNum(n) {
  return typeof n === 'number' && isFinite(n) ? n : 0;
}
const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40 });
locations.forEach(loc => {
  const lat = safeNum(loc.lat);
  const lng = safeNum(loc.lng);
  const icon = L.divIcon({
    html: '<div class="pin"><div class="head" style="background:' + safeColor(loc.color) + '"><span class="emoji">' + escapeHtml(loc.emoji) + '</span></div></div>',
    className: '', iconSize: [32, 42], iconAnchor: [16, 42], popupAnchor: [0, -38]
  });
  const m = L.marker([lat, lng], { icon });
  let html = '<div class="pop-title">' + escapeHtml(loc.name) + '</div>';
  if (loc.tag) html += '<div class="pop-tag">#' + escapeHtml(loc.tag) + '</div>';
  if (loc.date) html += '<div class="pop-addr">🗓 ' + escapeHtml(loc.date) + '</div>';
  html += '<div class="pop-actions">';
  html += '<a class="pop-btn gmap" target="_top" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(lat + ',' + lng) + '">🗺 Google Maps</a>';
  html += '</div>';
  m.bindPopup(html);
  cluster.addLayer(m);
});
map.addLayer(cluster);

// 全マーカーが収まるようフィット (場所がある場合)
if (locations.length > 1) {
  const bounds = L.latLngBounds(locations.map(l => [l.lat, l.lng]));
  if (myLoc) bounds.extend(myLoc);
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
}
</script>
</body>
</html>`;
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const show = useToastStore((s) => s.show);

  const [mode, setMode] = useState<Mode>('all');
  const [center, setCenter] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [loadingLoc, setLoadingLoc] = useState(false);
  const [search, setSearch] = useState('');

  // map location データはほぼ静的 — 5 分は信用して network roundtrip を削減
  const events = useQuery({
    queryKey: ['map-events'],
    queryFn: fetchEventLocations,
    staleTime: 5 * 60_000,
  });
  const spots = useQuery({
    queryKey: ['map-spots'],
    queryFn: fetchTourismSpots,
    staleTime: 5 * 60_000,
  });

  const items: MapLocation[] = useMemo(() => {
    const ev = events.data ?? [];
    const sp = spots.data ?? [];
    if (mode === 'event') return ev;
    if (mode === 'spot') return sp;
    return [...ev, ...sp];
  }, [mode, events.data, spots.data]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.toLowerCase();
    return items.filter((it) =>
      it.name.toLowerCase().includes(s)
      || (it.address?.toLowerCase().includes(s) ?? false)
      || (it.tag_name?.toLowerCase().includes(s) ?? false),
    );
  }, [items, search]);

  const sortedItems = useMemo(() => {
    if (!center) return filteredItems;
    return [...filteredItems]
      .map((it) => ({ ...it, _dist: distanceKm(center.lat, center.lng, it.lat, it.lng) }))
      .sort((a, b) => a._dist - b._dist);
  }, [filteredItems, center]);

  const getMyLocation = async () => {
    setLoadingLoc(true);
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '現在地' });
              setLoadingLoc(false);
            },
            () => { show('位置情報の取得に失敗しました', 'warn'); setLoadingLoc(false); },
            { timeout: 8000 },
          );
        } else { show('このブラウザは位置情報に対応していません', 'warn'); setLoadingLoc(false); }
      } else {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') { show('位置情報の権限がありません', 'warn'); setLoadingLoc(false); return; }
        const loc = await Location.getCurrentPositionAsync({});
        setCenter({ lat: loc.coords.latitude, lng: loc.coords.longitude, label: '現在地' });
        setLoadingLoc(false);
      }
    } catch { show('位置情報の取得に失敗しました', 'warn'); setLoadingLoc(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { getMyLocation(); }, []);

  const isLoading = events.isLoading || spots.isLoading;

  // マップ HTML 生成
  const mapHTML = useMemo(() => {
    const c = center ?? { lat: 35.6586, lng: 139.7454, label: '東京' };
    const locs = sortedItems.map((it) => ({
      id: it.id,
      lat: it.lat, lng: it.lng,
      name: it.name,
      emoji: it.kind === 'event' ? '🎟️' : '⛩️',
      color: it.kind === 'event' ? '#7C6AF7' : '#F472B6',
      tag: it.tag_name ?? null,
      date: it.event_date ?? null,
    }));
    return buildLeafletHTML({
      centerLat: c.lat, centerLng: c.lng,
      myLat: center?.label === '現在地' ? center.lat : null,
      myLng: center?.label === '現在地' ? center.lng : null,
      locations: locs,
      zoom: 12,
    });
  }, [center, sortedItems]);

  const openInMaps = (lat: number, lng: number) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      void safeOpenUrl(url, { errorMessage: 'マップを開けませんでした' });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="マップ"
        left={<BackButton />}
        right={
          <PressableScale onPress={getMyLocation} haptic="tap" disabled={loadingLoc} style={{ padding: SP['2'] }}>
            {loadingLoc ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : (
              <Icon.map size={20} color={C.accent} strokeWidth={2.2} />
            )}
          </PressableScale>
        }
      />

      {/* === マップ本体 (web のみ・iframe Leaflet) === */}
      {Platform.OS === 'web' ? (
        <View style={{
          marginHorizontal: SP['3'],
          marginTop: SP['2'],
          height: 360,
          borderRadius: R.lg,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: C.border,
        }}>
          <iframe
            key={`${center?.lat ?? 0}-${center?.lng ?? 0}-${mode}-${sortedItems.length}`}
            srcDoc={mapHTML}
            style={{ width: '100%', height: '100%', border: 0 } as object}
            title="map"
          />
        </View>
      ) : (
        <View style={{
          marginHorizontal: SP['3'], marginTop: SP['2'],
          height: 200, borderRadius: R.lg,
          backgroundColor: C.bg2, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: C.border, gap: SP['2'],
        }}>
          {/* 装飾絵文字 (🗺) 撤去 */}
          <Text style={[T.smallM, { color: C.text2 }]}>モバイル版マップは近日対応</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SP['6'] }}>
        {/* 検索バー */}
        <View style={{ paddingHorizontal: SP['3'], paddingTop: SP['3'] }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: SP['2'],
            paddingHorizontal: SP['3'], paddingVertical: SP['2'],
            backgroundColor: C.bg2, borderRadius: R.full,
            borderWidth: 1, borderColor: C.border,
          }}>
            <Icon.search size={18} color={C.text3} strokeWidth={2.2} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="場所・タグ・住所で検索…"
              placeholderTextColor={C.text3}
              style={[T.body, { flex: 1, color: C.text, paddingVertical: 0 }]}
              autoCapitalize="none"
              // memory DoS 対策: 検索クエリは 200 文字 cap
              maxLength={200}
            />
            {search.length > 0 && (
              <PressableScale onPress={() => setSearch('')} haptic="tap">
                <Icon.close size={16} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            )}
          </View>
        </View>

        {/* モード切替 (3 種類) */}
        <View style={{ paddingHorizontal: SP['3'], paddingTop: SP['3'], flexDirection: 'row', gap: 6 }}>
          {([
            { v: 'all',   label: 'すべて',   emoji: '✨', color: C.accent },
            { v: 'event', label: 'イベント', emoji: '🎟️', color: C.accent },
            { v: 'spot',  label: '聖地',     emoji: '⛩️', color: C.pink },
          ] as const).map((m) => {
            const active = mode === m.v;
            return (
              <PressableScale
                key={m.v}
                onPress={() => setMode(m.v)}
                haptic="select"
                style={{
                  flex: 1, paddingVertical: SP['2'],
                  backgroundColor: active ? m.color : C.bg2,
                  borderRadius: R.full,
                  borderWidth: 1, borderColor: active ? m.color : C.border,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}
              >
                <Text style={{ fontSize: 13 }}>{m.emoji}</Text>
                <Text style={[T.smallM, { color: active ? '#fff' : C.text2, fontWeight: '700' }]}>
                  {m.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        {/* 主要エリア */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: SP['3'], paddingTop: SP['3'] }}>
          <PressableScale
            onPress={getMyLocation}
            haptic="tap"
            disabled={loadingLoc}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['3'], paddingVertical: 6,
              backgroundColor: center?.label === '現在地' ? '#3a8efd' : C.bg3,
              borderRadius: R.full,
              borderWidth: 1, borderColor: center?.label === '現在地' ? '#3a8efd' : C.border,
            }}
          >
            <Icon.map size={13} color={center?.label === '現在地' ? '#fff' : C.text2} strokeWidth={2.4} />
            <Text style={[T.caption, { color: center?.label === '現在地' ? '#fff' : C.text2, fontWeight: '700' }]}>
              現在地
            </Text>
          </PressableScale>
          {PRESET_AREAS.map((area) => {
            const active = center?.label === area.name;
            return (
              <PressableScale
                key={area.name}
                onPress={() => setCenter({ lat: area.lat, lng: area.lng, label: area.name })}
                haptic="select"
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: SP['3'], paddingVertical: 6,
                  backgroundColor: active ? C.accent : C.bg2,
                  borderRadius: R.full,
                  borderWidth: 1, borderColor: active ? C.accent : C.border,
                }}
              >
                <Text style={{ fontSize: 13 }}>{area.emoji}</Text>
                <Text style={[T.caption, { color: active ? '#fff' : C.text2, fontWeight: '700' }]}>
                  {area.name}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>

        {/* 結果サマリ */}
        <View style={{ paddingHorizontal: SP['3'], paddingTop: SP['3'], flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>
            📍 {sortedItems.length}件
          </Text>
          {center && (
            <Text style={[T.caption, { color: C.text3 }]}>
              · 起点: {center.label}
            </Text>
          )}
        </View>

        {/* 一覧 */}
        <View style={{ paddingHorizontal: SP['3'], paddingTop: SP['3'], gap: SP['2'] }}>
          {isLoading ? (
            <ActivityIndicator color={C.accent} />
          ) : sortedItems.length === 0 ? (
            <EmptyState
              icon={mode === 'event' ? Icon.calendar : Icon.map}
              title="該当する場所がありません"
              message="別の地域や検索キーワードを試してください"
              tone="accent"
            />
          ) : (
            sortedItems.slice(0, 30).map((it) => {
              const dist = center ? distanceKm(center.lat, center.lng, it.lat, it.lng) : null;
              const distLabel = dist == null ? '' : dist < 1 ? `${(dist * 1000).toFixed(0)}m` : `${dist.toFixed(1)}km`;
              const isEvent = it.kind === 'event';
              return (
                <PressableScale
                  key={it.id}
                  onPress={() => setCenter({ lat: it.lat, lng: it.lng, label: it.name })}
                  haptic="select"
                  style={{
                    flexDirection: 'row',
                    gap: SP['3'],
                    padding: SP['3'],
                    backgroundColor: C.bg2,
                    borderRadius: R.lg,
                    borderWidth: 1, borderColor: C.border,
                  }}
                >
                  <View style={{
                    width: 44, height: 44, borderRadius: 22,
                    backgroundColor: isEvent ? C.accentBg : C.pinkBg,
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 2, borderColor: isEvent ? C.accent : C.pink,
                  }}>
                    <Text style={{ fontSize: 20 }}>{isEvent ? '🎟️' : '⛩️'}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                      <Text style={[T.bodyMd, { color: C.text, flex: 1 }]} numberOfLines={1}>
                        {it.name}
                      </Text>
                      {distLabel && (
                        <View style={{
                          paddingHorizontal: SP['2'], paddingVertical: 1,
                          backgroundColor: C.bg3, borderRadius: R.sm,
                        }}>
                          <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>{distLabel}</Text>
                        </View>
                      )}
                    </View>
                    {it.address && (
                      <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                        📍 {it.address}
                      </Text>
                    )}
                    <View style={{ flexDirection: 'row', gap: SP['2'], alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                      {it.tag_name && (
                        <PressableScale
                          onPress={() => router.push(`/tag/${encodeURIComponent(it.tag_name!)}` as never)}
                          haptic="tap"
                        >
                          <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>#{it.tag_name}</Text>
                        </PressableScale>
                      )}
                      {it.event_date && (
                        <Text style={[T.caption, { color: C.amber }]}>🗓 {it.event_date}</Text>
                      )}
                      {it.rating && (
                        <Text style={[T.caption, { color: C.text3 }]}>★ {it.rating.toFixed(1)}</Text>
                      )}
                    </View>
                    {/* アクション */}
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                      <PressableScale
                        onPress={() => openInMaps(it.lat, it.lng)}
                        haptic="confirm"
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 3,
                          paddingHorizontal: 8, paddingVertical: 3,
                          backgroundColor: '#4285f422',
                          borderRadius: R.sm,
                          borderWidth: 1, borderColor: '#4285f455',
                        }}
                      >
                        <Text style={{ fontSize: 9 }}>🗺</Text>
                        <Text style={{ fontSize: 10, color: '#4285f4', fontWeight: '700' }}>
                          Google Maps で開く
                        </Text>
                      </PressableScale>
                    </View>
                  </View>
                </PressableScale>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}
