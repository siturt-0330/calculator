// ============================================================
// 聖地 編集画面 — create.tsx の対の wiki 編集 UI
// ------------------------------------------------------------
// migration 0045 で community member 全員が UPDATE / DELETE できる
// 「wiki 型」ポリシー。create.tsx と同じく住所 geocode + マップ救済 + 8
// カテゴリの UI を踏襲しつつ、保存ボタンは「更新」、追加で「削除」ボタン。
//
// パス: /community/[id]/spot/[spotId]/edit
// ============================================================

import { View, Text, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '../../../../../../design/tokens';
import { T } from '../../../../../../design/typography';
import { BackButton } from '../../../../../../components/nav/BackButton';
import { Input } from '../../../../../../components/ui/Input';
import { Button } from '../../../../../../components/ui/Button';
import { PressableScale } from '../../../../../../components/ui/PressableScale';
import { ConfirmDialog } from '../../../../../../components/ui/ConfirmDialog';
import { Icon } from '../../../../../../constants/icons';
import { useToastStore } from '../../../../../../stores/toastStore';
import {
  fetchSpotById,
  updateSpot,
  deleteSpot,
  SELECTABLE_SPOT_CATEGORIES,
  SPOT_CATEGORY_META,
  type SpotCategory,
} from '../../../../../../lib/api/communities';
import { TABBAR } from '../../../../../../design/tabbar';
import { AddressSearch } from '../../../../../../components/map/AddressSearch';
import { SpotMapPicker } from '../../../../../../components/map/SpotMapPicker';
import type { GeocodeResult } from '../../../../../../lib/geocode';

export default function EditSpotScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const spotId = typeof params.spotId === 'string' ? params.spotId : '';
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();

  const { data: spot, isLoading } = useQuery({
    queryKey: ['community', id, 'spot', spotId],
    queryFn: () => fetchSpotById(spotId),
    enabled: spotId.length > 0,
  });

  // 入力 state — spot 取得後に hydrate
  const [coord, setCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<SpotCategory>('work_setting');
  const [hydrated, setHydrated] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (spot && !hydrated) {
      setCoord({ lat: spot.lat, lon: spot.lon });
      setName(spot.name);
      setDescription(spot.description ?? '');
      setCategory(spot.category as SpotCategory);
      setHydrated(true);
    }
  }, [spot, hydrated]);

  const handleSelectAddress = (r: GeocodeResult) => {
    setCoord({ lat: r.lat, lon: r.lon });
    if (name.trim().length === 0) {
      setName(r.displayName);
    }
  };

  const canSubmit =
    coord !== null &&
    name.trim().length > 0 &&
    !submitting &&
    hydrated;

  const handleSubmit = async () => {
    if (!canSubmit || !coord || !spot) return;
    setSubmitting(true);
    const { error } = await updateSpot(spotId, {
      name: name.trim(),
      description: description.trim(),
      lat: coord.lat,
      lon: coord.lon,
      category,
    });
    setSubmitting(false);
    if (error) {
      show(error, 'error');
      return;
    }
    show('聖地を更新しました', 'success');
    void qc.invalidateQueries({ queryKey: ['community', id, 'spots'] });
    void qc.invalidateQueries({ queryKey: ['community', id, 'spot', spotId] });
    router.back();
  };

  const deleteMutation = useMutation({
    mutationFn: () => deleteSpot(spotId),
    onSuccess: ({ error }) => {
      if (error) {
        show(error, 'error');
        return;
      }
      show('聖地を削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['community', id, 'spots'] });
      router.back();
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  if (isLoading || !hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (!spot) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: SP['6'], alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[T.body, { color: C.text2 }]}>聖地が見つかりませんでした</Text>
        <PressableScale onPress={() => router.back()} haptic="tap" style={{ marginTop: SP['4'] }}>
          <Text style={[T.smallB, { color: C.accent }]}>戻る</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>聖地を編集</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
          gap: SP['5'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* wiki 編集の説明 */}
        <View
          style={{
            padding: SP['2'] + 2,
            backgroundColor: C.amberBg,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.amber + '55',
          }}
        >
          <Text style={[T.caption, { color: C.amber, fontWeight: '700' }]}>
            📝 この聖地は誰でも編集できます (wiki 形式)。間違った情報があれば直してください。
          </Text>
        </View>

        {/* 1. 場所 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallB, { color: C.text2 }]}>場所</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            位置を変えたい時のみ住所を再検索 (例: 東京ドーム / 渋谷区神南 1-1)
          </Text>
          <AddressSearch
            onSelect={handleSelectAddress}
            onMapFallback={() => setMapOpen(true)}
          />
          {coord && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                padding: SP['2'] + 2,
                backgroundColor: C.greenBg,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.green + '55',
              }}
            >
              <Icon.shield size={14} color={C.green} strokeWidth={2.4} />
              <Text style={[T.small, { color: C.green, flex: 1 }]} numberOfLines={1}>
                位置: {coord.lat.toFixed(5)}, {coord.lon.toFixed(5)}
              </Text>
              <PressableScale
                onPress={() => setMapOpen(true)}
                haptic="tap"
                style={{ paddingHorizontal: SP['2'], paddingVertical: 2 }}
              >
                <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
                  マップで微調整
                </Text>
              </PressableScale>
            </View>
          )}
        </View>

        {/* 2. カテゴリ */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallB, { color: C.text2 }]}>カテゴリ ★必須</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {SELECTABLE_SPOT_CATEGORIES.map((c) => {
              const meta = SPOT_CATEGORY_META[c];
              const isSelected = category === c;
              return (
                <PressableScale
                  key={c}
                  onPress={() => setCategory(c)}
                  haptic="select"
                  hitSlop={4}
                  accessibilityLabel={`${meta.label} を選択`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 7,
                    borderRadius: R.full,
                    backgroundColor: isSelected ? meta.color + '33' : C.bg3,
                    borderWidth: 1.5,
                    borderColor: isSelected ? meta.color : C.border,
                  }}
                >
                  {/* 装飾絵文字 (🎤 等) を撤去 → color dot のみで category 識別。spot/create と同じパターン。 */}
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: meta.color,
                      opacity: isSelected ? 1 : 0.7,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      color: isSelected ? meta.color : C.text2,
                      fontWeight: '700',
                    }}
                  >
                    {meta.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {/* 3. 名前 */}
        <Input
          label="名前 ★必須"
          placeholder="例: ○○神社"
          value={name}
          onChangeText={setName}
          maxLength={80}
        />

        {/* 4. 説明 */}
        <Input
          label="説明 (任意)"
          placeholder="どんな場所か / ファン的におすすめのポイントなど"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          maxLength={500}
          textAlignVertical="top"
        />

        {/* 5. 更新 */}
        <Button
          label={submitting ? '更新中…' : '更新する'}
          onPress={handleSubmit}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={submitting}
          haptic="confirm"
        />

        {/* 6. 削除 (危険ゾーン) */}
        <View
          style={{
            marginTop: SP['4'],
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.red + '33',
            gap: SP['2'],
          }}
        >
          <Text style={[T.smallB, { color: C.red }]}>危険な操作</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            削除するとこの聖地は元に戻せません。重複や間違った登録の整理にだけ使ってください。
          </Text>
          <PressableScale
            onPress={() => setDeleteDialogOpen(true)}
            haptic="warn"
            disabled={deleteMutation.isPending}
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              backgroundColor: C.red + '22',
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.red + '55',
              opacity: deleteMutation.isPending ? 0.5 : 1,
            }}
          >
            <Text style={[T.smallB, { color: C.red, fontWeight: '700' }]}>
              {deleteMutation.isPending ? '削除中…' : '🗑 この聖地を削除'}
            </Text>
          </PressableScale>
        </View>
      </ScrollView>

      <SpotMapPicker
        visible={mapOpen}
        initialCoord={coord ?? undefined}
        onConfirm={(c) => {
          setCoord(c);
          setMapOpen(false);
        }}
        onClose={() => setMapOpen(false)}
      />

      <ConfirmDialog
        visible={deleteDialogOpen}
        title="聖地を削除"
        message={`「${spot.name}」を削除します。元に戻せません。`}
        confirmLabel="削除する"
        onConfirm={() => {
          setDeleteDialogOpen(false);
          deleteMutation.mutate();
        }}
        onCancel={() => setDeleteDialogOpen(false)}
        destructive
      />
    </KeyboardAvoidingView>
  );
}
