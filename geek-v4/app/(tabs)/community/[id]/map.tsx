// ============================================================
// 公式 マップ
// ============================================================
// 各位置 (聖地・店舗・観光地・宿泊・イベント・その他) を表示。
// - web: 簡易リスト + 「Google Maps で開く」リンク (iframe では複数ピンを
//   描けないため、リストの下に最初の地点だけ iframe で簡易表示)
// - native: react-native-maps で markers を一括描画
// ============================================================
import { View, Text, ScrollView, Modal, TextInput, ActivityIndicator, Platform } from 'react-native';
import { safeOpenUrl } from '../../../../lib/openUrl';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { BackButton } from '../../../../components/nav/BackButton';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Spinner } from '../../../../components/ui/Spinner';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { Icon } from '../../../../constants/icons';
import { OfficialBadge } from '../../../../components/community/OfficialBadge';
import { useToastStore } from '../../../../stores/toastStore';
import { useAuthStore } from '../../../../stores/authStore';
import { fetchCommunity } from '../../../../lib/api/communities';
import {
  fetchMapLocations,
  createMapLocation,
  deleteMapLocation,
  type MapLocation,
} from '../../../../lib/api/officialCommunities';
import { TABBAR } from '../../../../design/tabbar';

type Category = MapLocation['category'];
const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'spot',    label: '聖地' },
  { key: 'shop',    label: '店舗' },
  { key: 'food',    label: 'グルメ' },
  { key: 'lodging', label: '宿泊' },
  { key: 'event',   label: 'イベント' },
  { key: 'other',   label: 'その他' },
];

const CATEGORY_COLOR: Record<Category, string> = {
  spot: C.accent,
  shop: C.blue,
  food: C.amber,
  lodging: C.pink,
  event: C.green,
  other: C.text3,
};

function openInMaps(lat: number, lng: number, label: string) {
  const q = encodeURIComponent(label || `${lat},${lng}`);
  const url = Platform.select({
    ios: `https://maps.apple.com/?q=${q}&ll=${lat},${lng}`,
    default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
  });
  if (url) void safeOpenUrl(url, { errorMessage: 'マップを開けませんでした' });
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const userId = useAuthStore((s) => s.user?.id);
  const { show } = useToastStore();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MapLocation | null>(null);

  // form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [address, setAddress] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [category, setCategory] = useState<Category>('spot');

  const { data: community } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });
  const isAdmin = !!community && !!userId && community.official_admin_user_id === userId;

  const { data: locs = [], isLoading } = useQuery({
    queryKey: ['community', id, 'official-map'],
    queryFn: () => fetchMapLocations(id),
    enabled: id.length > 0,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: () => {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      if (Number.isNaN(latNum) || latNum < -90 || latNum > 90) throw new Error('緯度が不正です (-90〜90)');
      if (Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180) throw new Error('経度が不正です (-180〜180)');
      return createMapLocation({
        community_id: id,
        name: name.trim(),
        description: description.trim(),
        lat: latNum,
        lng: lngNum,
        address: address.trim(),
        image_url: imageUrl.trim() || null,
        category,
      });
    },
    onSuccess: () => {
      show('スポットを追加しました', 'success');
      setModalOpen(false);
      setName(''); setDescription(''); setLat(''); setLng(''); setAddress(''); setImageUrl('');
      setCategory('spot');
      void qc.invalidateQueries({ queryKey: ['community', id, 'official-map'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '追加に失敗しました';
      show(msg, 'error');
    },
  });

  const remove = useMutation({
    mutationFn: (lid: string) => deleteMapLocation(lid),
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['community', id, 'official-map'] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  const canSubmit =
    name.trim().length >= 1 &&
    !Number.isNaN(parseFloat(lat)) &&
    !Number.isNaN(parseFloat(lng)) &&
    !create.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
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
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[T.h3, { color: C.text }]}>地図</Text>
          {community?.is_official && <OfficialBadge size="sm" />}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['16'],
          gap: SP['3'],
        }}
      >
        {/* Map preview (web のみ iframe / native は markers) */}
        {locs.length > 0 && <MapPreview locations={locs} />}

        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : locs.length === 0 ? (
          <EmptyState
            icon={Icon.map}
            title="まだスポットがありません"
            message={isAdmin ? '右下の + ボタンから追加できます' : '管理者がスポットを追加するのを待ちましょう'}
            tone="green"
          />
        ) : (
          locs.map((l, i) => (
            <Animated.View key={l.id} entering={FadeInDown.delay(i * 30).duration(220)}>
              <LocationCard
                location={l}
                canDelete={isAdmin}
                onDelete={() => setPendingDelete(l)}
                onOpenMaps={() => openInMaps(l.lat, l.lng, l.name)}
              />
            </Animated.View>
          ))
        )}
      </ScrollView>

      {/* Admin FAB */}
      {isAdmin && (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', right: SP['4'], bottom: insets.bottom + TABBAR.height + SP['3'] }}
        >
          <PressableScale
            onPress={() => setModalOpen(true)}
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
            accessibilityLabel="スポットを追加"
          >
            <Icon.plus size={24} color="#fff" strokeWidth={2.6} />
          </PressableScale>
        </View>
      )}

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R['2xl'],
              borderTopRightRadius: R['2xl'],
              padding: SP['4'],
              paddingBottom: insets.bottom + SP['4'],
              gap: SP['3'],
              maxHeight: '90%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.h3, { color: C.text, flex: 1 }]}>スポットを追加</Text>
              <PressableScale
                onPress={() => setModalOpen(false)}
                haptic="tap"
                hitSlop={12}
                accessibilityLabel="閉じる"
                style={{ padding: 6 }}
              >
                <Icon.close size={20} color={C.text2} strokeWidth={2.4} />
              </PressableScale>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: SP['3'] }}>
              <Field label="名前">
                <TextInput value={name} onChangeText={setName} placeholder="例: ○○神社" placeholderTextColor={C.text3} style={fieldStyle} maxLength={120} />
              </Field>

              <Field label="カテゴリ">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {CATEGORIES.map((c) => {
                    const active = category === c.key;
                    return (
                      <PressableScale
                        key={c.key}
                        onPress={() => setCategory(c.key)}
                        haptic="select"
                        style={{
                          paddingHorizontal: SP['3'],
                          paddingVertical: 6,
                          backgroundColor: active ? CATEGORY_COLOR[c.key] : C.bg3,
                          borderRadius: R.full,
                          borderWidth: 1,
                          borderColor: active ? CATEGORY_COLOR[c.key] : C.border,
                        }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text2, fontSize: 12, fontWeight: '700' }}>
                          {c.label}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
              </Field>

              <View style={{ flexDirection: 'row', gap: SP['2'] }}>
                <View style={{ flex: 1 }}>
                  <Field label="緯度 (lat)">
                    <TextInput value={lat} onChangeText={setLat} placeholder="35.6586" placeholderTextColor={C.text3} keyboardType="numeric" style={fieldStyle} />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="経度 (lng)">
                    <TextInput value={lng} onChangeText={setLng} placeholder="139.7454" placeholderTextColor={C.text3} keyboardType="numeric" style={fieldStyle} />
                  </Field>
                </View>
              </View>

              <Field label="住所 (任意)">
                <TextInput value={address} onChangeText={setAddress} placeholder="例: 東京都港区..." placeholderTextColor={C.text3} style={fieldStyle} maxLength={200} />
              </Field>
              <Field label="画像 URL (任意)">
                <TextInput value={imageUrl} onChangeText={setImageUrl} placeholder="https://..." placeholderTextColor={C.text3} autoCapitalize="none" autoCorrect={false} style={fieldStyle} />
              </Field>
              <Field label="説明 (任意)">
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="このスポットの説明"
                  placeholderTextColor={C.text3}
                  multiline
                  style={[fieldStyle, { minHeight: 80, textAlignVertical: 'top' }]}
                  maxLength={1000}
                />
              </Field>
            </ScrollView>
            <PressableScale
              onPress={() => create.mutate()}
              haptic="confirm"
              disabled={!canSubmit}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: SP['3'],
                backgroundColor: C.accent,
                borderRadius: R.lg,
                opacity: canSubmit ? 1 : 0.5,
              }}
            >
              {create.isPending && <ActivityIndicator size="small" color="#fff" />}
              <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>追加する</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="スポットを削除"
        message={pendingDelete ? `「${pendingDelete.name}」を削除します。` : ''}
        confirmLabel="削除する"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        destructive
      />
    </View>
  );
}

const fieldStyle = {
  color: C.text,
  backgroundColor: C.bg3,
  borderRadius: R.md,
  paddingHorizontal: SP['3'],
  paddingVertical: SP['3'],
  ...T.body,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={[T.small, { color: C.text2 }]}>{label}</Text>
      {children}
    </View>
  );
}

// ============================================================
// MapPreview — web は iframe / native は react-native-maps
// ============================================================
function MapPreview({ locations }: { locations: MapLocation[] }) {
  if (Platform.OS === 'web') {
    return <WebMapPreview locations={locations} />;
  }
  return <NativeMapPreview locations={locations} />;
}

function WebMapPreview({ locations }: { locations: MapLocation[] }) {
  // 最初の地点を中心にした単純な埋め込み。複数ピンは API key が必要なため、
  // 「Google Maps で開く」ボタンを別途出している。
  const first = locations[0];
  if (!first) return null;
  const src = `https://www.google.com/maps?q=${first.lat},${first.lng}&z=14&output=embed`;
  // RN-Web で iframe を直接書くため、文字列タグを評価できる createElement にする
  // Note: React.createElement('iframe', ...) は RN-web で問題なく動く
  return (
    <View
      style={{
        height: 240,
        borderRadius: R.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.bg3,
      }}
    >
      <iframe
        src={src}
        style={{ border: 0, width: '100%', height: '100%' }}
        loading="lazy"
        title="map"
        // 監査指摘: iframe に sandbox / referrerpolicy が無い。
        // Google Maps Embed は scripts + same-origin が必要。
        // allow-popups は外部マップアプリへのリンクを開ける程度に絞る。
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
      />
    </View>
  );
}

function NativeMapPreview({ locations }: { locations: MapLocation[] }) {
  // Metro が web ビルドで react-native-maps を静的解析しないよう、
  // 文字列経由で require を呼ぶ (eval-require trick)。
  // RN web ビルドではこの関数自体が呼ばれないので副作用はない。
  let MapView: React.ComponentType<Record<string, unknown>> | null = null;
  let Marker: React.ComponentType<Record<string, unknown>> | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const dynRequire = new Function('mod', 'return require(mod)') as (m: string) => unknown;
    const mod = dynRequire('react-native-maps') as { default?: unknown; MapView?: unknown; Marker?: unknown };
    MapView = (mod.default ?? mod.MapView) as React.ComponentType<Record<string, unknown>>;
    Marker = mod.Marker as React.ComponentType<Record<string, unknown>>;
  } catch {
    MapView = null;
  }
  if (!MapView || !Marker || locations.length === 0) return null;
  const first = locations[0]!;
  return (
    <View
      style={{
        height: 280,
        borderRadius: R.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <MapView
        style={{ flex: 1 }}
        initialRegion={{
          latitude: first.lat,
          longitude: first.lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {locations.map((l) => (
          <Marker
            key={l.id}
            coordinate={{ latitude: l.lat, longitude: l.lng }}
            title={l.name}
            description={l.address}
            pinColor={CATEGORY_COLOR[l.category]}
          />
        ))}
      </MapView>
    </View>
  );
}

function LocationCard({
  location,
  canDelete,
  onDelete,
  onOpenMaps,
}: {
  location: MapLocation;
  canDelete: boolean;
  onDelete: () => void;
  onOpenMaps: () => void;
}) {
  const color = CATEGORY_COLOR[location.category];
  const catLabel = CATEGORIES.find((c) => c.key === location.category)?.label ?? location.category;
  return (
    <View
      style={[{
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
      }, SHADOW.card]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
        <Text style={[T.bodyB, { color: C.text, flex: 1 }]} numberOfLines={2}>{location.name}</Text>
        <View
          style={{
            paddingHorizontal: SP['2'],
            paddingVertical: 2,
            backgroundColor: color + '22',
            borderRadius: R.sm,
            borderWidth: 1,
            borderColor: color + '55',
          }}
        >
          <Text style={{ color, fontSize: 10, fontWeight: '700' }}>{catLabel}</Text>
        </View>
        {canDelete && (
          <PressableScale onPress={onDelete} haptic="warn" hitSlop={6} style={{ padding: 4 }}>
            <Icon.trash size={14} color={C.red} strokeWidth={2.2} />
          </PressableScale>
        )}
      </View>
      {location.description.length > 0 && (
        <Text style={[T.small, { color: C.text2 }]} numberOfLines={3}>{location.description}</Text>
      )}
      {location.address.length > 0 && (
        <PressableScale
          onPress={onOpenMaps}
          haptic="tap"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: SP['3'],
            paddingVertical: 8,
            backgroundColor: C.bg3,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Icon.map size={12} color={C.text3} strokeWidth={2.2} />
          <Text style={[T.small, { color: C.text2, flex: 1 }]} numberOfLines={1}>{location.address}</Text>
          <Icon.chevronR size={14} color={C.text3} strokeWidth={2.4} />
        </PressableScale>
      )}
    </View>
  );
}
