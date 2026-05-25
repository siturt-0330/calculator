// ============================================================
// components/map/SpotMapPicker.tsx
// ------------------------------------------------------------
// マップ modal で pin を立てる UI:
//   - Native (iOS/Android): react-native-maps (Apple/Google Maps)
//   - Web: react-native-maps の web フォールバックは limited なので、
//     OpenStreetMap (Leaflet) の iframe 風実装か、シンプルに lat/lon を
//     数値入力させて Google Maps プレビューを開く救済 UI で代替する。
//     本 PR では「Web は OSM iframe embed + 中央 pin の表示」+
//     「現在地ボタン / リセットボタン」のみ対応。pin のドラッグは
//     react-native-maps Native でのみ対応 (Web は中央固定 + ドラッグ風
//     スクロールで lat/lon を更新)。
//
// 入出力:
//   - props.visible で表示制御
//   - props.initialCoord で初期位置 (省略時は東京駅)
//   - props.onConfirm({lat, lon}) で確定時に親へ通知
//   - props.onClose で modal 閉じる
// ============================================================
import { useEffect, useState } from 'react';
import { View, Text, Platform, Modal } from 'react-native';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Coord = { lat: number; lon: number };

const TOKYO_STATION: Coord = { lat: 35.681236, lon: 139.767125 };

type Props = {
  visible: boolean;
  initialCoord?: Coord;
  onConfirm: (coord: Coord) => void;
  onClose: () => void;
};

export function SpotMapPicker({ visible, initialCoord, onConfirm, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [coord, setCoord] = useState<Coord>(initialCoord ?? TOKYO_STATION);

  useEffect(() => {
    if (visible) {
      setCoord(initialCoord ?? TOKYO_STATION);
    }
  }, [visible, initialCoord]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)' }}>
        {/* Header */}
        <View
          style={{
            paddingTop: insets.top + SP['2'],
            paddingHorizontal: SP['4'],
            paddingBottom: SP['2'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
            backgroundColor: C.bg,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          }}
        >
          <PressableScale
            onPress={onClose}
            haptic="tap"
            hitSlop={10}
            accessibilityLabel="閉じる"
            style={{ padding: SP['2'], marginLeft: -SP['2'] }}
          >
            <Icon.close size={22} color={C.text} strokeWidth={2.4} />
          </PressableScale>
          <Text style={[T.h4, { color: C.text, flex: 1 }]}>マップで指定</Text>
          <PressableScale
            onPress={() => onConfirm(coord)}
            haptic="confirm"
            style={{
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'] - 2,
              backgroundColor: C.accent,
              borderRadius: R.full,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>確定</Text>
          </PressableScale>
        </View>

        {/* Map area */}
        {Platform.OS === 'web' ? (
          <WebMapPlaceholder coord={coord} onChange={setCoord} />
        ) : (
          <NativeMapPicker coord={coord} onChange={setCoord} />
        )}

        {/* 現在の座標表示 (debug + 確認用) */}
        <View
          style={{
            paddingHorizontal: SP['4'],
            paddingVertical: SP['3'],
            paddingBottom: insets.bottom + SP['3'],
            backgroundColor: C.bg,
            borderTopWidth: 1,
            borderTopColor: C.border,
          }}
        >
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            タップ or ドラッグで pin を移動 ・ 確定すると住所が自動入力されます
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================
// Web: OpenStreetMap iframe + 中央固定 pin
// ------------------------------------------------------------
// react-native-maps の web 対応は限定的なので OSM iframe で代替。
// iframe 内の地図インタラクションでは pin 位置を読めないため、
// 「マップで指定」ボタンを押した時点での中央座標を採用する設計。
// 簡易だが Web では address 入力をメインにしてもらう前提なので
// fallback として十分。
// ============================================================
function WebMapPlaceholder({
  coord,
  onChange,
}: {
  coord: Coord;
  onChange: (c: Coord) => void;
}) {
  // OSM 公式の embed bbox (lon-0.005..lon+0.005, lat-0.005..lat+0.005)
  const bbox = `${coord.lon - 0.005}%2C${coord.lat - 0.005}%2C${coord.lon + 0.005}%2C${coord.lat + 0.005}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coord.lat}%2C${coord.lon}`;
  return (
    <View style={{ flex: 1, position: 'relative' }}>
      {/* RN Web では iframe は WebView 不要、直 HTML として使える */}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {React.createElement('iframe' as any, {
        src,
        style: { flex: 1, border: 0, width: '100%', height: '100%' },
        title: 'マップ',
      })}
      {/* 操作説明 + 微調整 (Web は iframe 内 drag が漏れないので簡易) */}
      <View
        style={{
          position: 'absolute',
          bottom: SP['4'],
          left: SP['4'],
          right: SP['4'],
          padding: SP['3'],
          backgroundColor: C.glassDark,
          borderRadius: R.lg,
          gap: SP['2'],
        }}
      >
        <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
          現在の中心: {coord.lat.toFixed(5)}, {coord.lon.toFixed(5)}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <NudgeButton label="↑" onPress={() => onChange({ ...coord, lat: coord.lat + 0.001 })} />
          <NudgeButton label="↓" onPress={() => onChange({ ...coord, lat: coord.lat - 0.001 })} />
          <NudgeButton label="←" onPress={() => onChange({ ...coord, lon: coord.lon - 0.001 })} />
          <NudgeButton label="→" onPress={() => onChange({ ...coord, lon: coord.lon + 0.001 })} />
        </View>
      </View>
    </View>
  );
}

function NudgeButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      hitSlop={4}
      style={{
        width: 40,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: C.bg3,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Text style={{ color: C.text, fontSize: 18, fontWeight: '700' }}>{label}</Text>
    </PressableScale>
  );
}

// ============================================================
// Native: react-native-maps の Marker draggable
// ============================================================
function NativeMapPicker({
  coord,
  onChange,
}: {
  coord: Coord;
  onChange: (c: Coord) => void;
}) {
  // require を関数内に gate して Web bundle から完全に外す
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Maps = require('react-native-maps');
  const MapView = Maps.default;
  const { Marker } = Maps;

  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={{
          latitude: coord.lat,
          longitude: coord.lon,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        onPress={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
          onChange({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude });
        }}
      >
        <Marker
          coordinate={{ latitude: coord.lat, longitude: coord.lon }}
          draggable
          onDragEnd={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
            onChange({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude });
          }}
        />
      </MapView>
    </View>
  );
}

// Web iframe を React.createElement で出すために React を named import
// eslint-disable-next-line @typescript-eslint/no-require-imports
const React = require('react') as typeof import('react');
