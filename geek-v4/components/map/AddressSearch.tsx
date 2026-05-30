// ============================================================
// components/map/AddressSearch.tsx
// ------------------------------------------------------------
// 住所 / 施設名 を 1 行で入力 → 350ms debounce → geocode → 候補 3 件を
// タップで選択する UI。「📍 現在地を使う」ボタン併設。
//
// 設計:
//   - debounce 350ms (Nominatim 規約 ≤ 1 req/sec を守る)
//   - 候補は 3 件まで表示 (geocode の MAX_RESULTS と一致)
//   - 0 件失敗時は「マップで指定」ボタンを表示 → caller (onMapFallback) で
//     SpotMapPicker を開く
//   - 現在地ボタン: Web は navigator.geolocation, Native は expo-location
//     (権限が必要なので初回タップで OS prompt が出る)
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Platform, ActivityIndicator } from 'react-native';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { geocode, reverseGeocode, type GeocodeResult } from '../../lib/geocode';
import { swallow } from '../../lib/swallow';

const DEBOUNCE_MS = 350;

type Props = {
  /** 候補がタップされた / 現在地が確定したときに呼ばれる */
  onSelect: (result: GeocodeResult) => void;
  /** geocode が 0 件返したとき、マップ救済ボタンが押されると発火 */
  onMapFallback: () => void;
  /** 初期値 (編集画面で fill しておく住所) */
  initialQuery?: string;
};

export function AddressSearch({ onSelect, onMapFallback, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [candidates, setCandidates] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false); // 1 回でも検索したか (0 件 UI 出す判定)
  const [locating, setLocating] = useState(false);
  const reqIdRef = useRef(0);

  // debounce 後に geocode を発火
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setCandidates([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const id = ++reqIdRef.current;
    const timer = setTimeout(async () => {
      const results = await geocode(q);
      // race condition 防止: 別の入力が走ってたら結果を捨てる
      if (id !== reqIdRef.current) return;
      setCandidates(results);
      setSearched(true);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const handleUseCurrentLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      if (Platform.OS === 'web') {
        // Web: navigator.geolocation
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          throw new Error('現在地取得に対応していません');
        }
        await new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              const { latitude, longitude } = pos.coords;
              const r = await reverseGeocode(latitude, longitude);
              onSelect(r ?? {
                displayName: '現在地',
                address: '',
                lat: latitude,
                lon: longitude,
              });
              resolve();
            },
            () => reject(new Error('現在地が取得できませんでした')),
            { timeout: 10_000, enableHighAccuracy: false },
          );
        });
      } else {
        // Native: expo-location (位置情報権限が必要)
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const Location = require('expo-location');
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          throw new Error('位置情報の許可が必要です');
        }
        const pos = await Location.getCurrentPositionAsync({});
        const { latitude, longitude } = pos.coords;
        const r = await reverseGeocode(latitude, longitude);
        onSelect(r ?? {
          displayName: '現在地',
          address: '',
          lat: latitude,
          lon: longitude,
        });
      }
    } catch (e) {
      swallow('address-search.current-location', e);
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={{ gap: SP['2'] }}>
      {/* 入力 + 現在地ボタン */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
            backgroundColor: C.bg3,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: query.length > 0 ? C.accent : C.border,
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'] + 2,
          }}
        >
          <Icon.search size={16} color={C.text3} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="施設名や住所を入力 (例: 東京ドーム)"
            placeholderTextColor={C.text3}
            style={{ flex: 1, color: C.text, fontSize: 14 }}
            returnKeyType="search"
            clearButtonMode="while-editing"
            keyboardAppearance="dark"
            accessibilityLabel="施設名や住所"
            // memory DoS 対策: 住所/施設名は 200 文字 cap
            maxLength={200}
          />
          {loading && <ActivityIndicator size="small" color={C.accent} />}
        </View>
        <PressableScale
          onPress={handleUseCurrentLocation}
          disabled={locating}
          haptic="tap"
          hitSlop={6}
          accessibilityLabel="現在地を使う"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'] + 2,
            borderRadius: R.full,
            backgroundColor: locating ? C.bg3 : C.accentBg,
            borderWidth: 1,
            borderColor: C.accent + '55',
            opacity: locating ? 0.6 : 1,
          }}
        >
          {locating ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <>
              <Icon.map size={14} color={C.accent} strokeWidth={2.4} />
              <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>現在地</Text>
            </>
          )}
        </PressableScale>
      </View>

      {/* 候補リスト (タップで選択) */}
      {candidates.length > 0 && (
        <View style={{ gap: SP['1'] }}>
          {candidates.map((c, i) => (
            <PressableScale
              key={`${c.lat}-${c.lon}-${i}`}
              onPress={() => onSelect(c)}
              haptic="select"
              hitSlop={4}
              accessibilityLabel={`${c.displayName} を選択`}
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'] + 2,
                backgroundColor: C.bg2,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.border,
                gap: 2,
              }}
            >
              <Text style={[T.bodyM, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                {c.displayName}
              </Text>
              {c.address && c.address !== c.displayName && (
                <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                  {c.address}
                </Text>
              )}
            </PressableScale>
          ))}
        </View>
      )}

      {/* 0 件失敗時の救済 UI */}
      {searched && !loading && candidates.length === 0 && query.trim().length >= 2 && (
        <View
          style={{
            padding: SP['3'],
            backgroundColor: C.amberBg,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.amber + '55',
            gap: SP['2'],
          }}
        >
          <Text style={[T.small, { color: C.amber }]}>
            「{query}」が見つかりませんでした。
          </Text>
          <PressableScale
            onPress={onMapFallback}
            haptic="confirm"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: SP['2'],
              backgroundColor: C.bg2,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Icon.map size={14} color={C.text} strokeWidth={2.4} />
            <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
              マップで指定する
            </Text>
          </PressableScale>
        </View>
      )}
    </View>
  );
}
