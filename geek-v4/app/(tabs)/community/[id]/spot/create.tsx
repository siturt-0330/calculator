// ============================================================
// 聖地登録 (community spot create) — 2026-05 全面改修
// ------------------------------------------------------------
// 旧: 緯度経度を手で打たせる UX。多くのユーザーが座標を知らず詰む。
//
// 新: 住所/施設名を 1 行入力 → 自動 geocode → 候補 3 件タップ選択
//     0 件失敗 → マップで指定 (modal でタップ)
//     現在地ボタン (Web / Native 両対応, expo-location 利用)
//     カテゴリ必須 (8 値プリセット)
//     写真任意 (推奨 chip 表示)
//     重複警告 (同コミュ内の類似名 spot を出す、登録は許可)
//
// 緯度経度は UI から完全に消えて internal 状態としてのみ持つ。
// ============================================================

import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '../../../../../design/tokens';
import { T } from '../../../../../design/typography';
import { BackButton } from '../../../../../components/nav/BackButton';
import { Input } from '../../../../../components/ui/Input';
import { Button } from '../../../../../components/ui/Button';
import { PressableScale } from '../../../../../components/ui/PressableScale';
import { Icon } from '../../../../../constants/icons';
import { useToastStore } from '../../../../../stores/toastStore';
import {
  createSpot,
  fetchCommunitySpots,
  SELECTABLE_SPOT_CATEGORIES,
  SPOT_CATEGORY_META,
  type SpotCategory,
} from '../../../../../lib/api/communities';
import { TABBAR } from '../../../../../design/tabbar';
import { AddressSearch } from '../../../../../components/map/AddressSearch';
import { SpotMapPicker } from '../../../../../components/map/SpotMapPicker';
import { findSimilar } from '../../../../../lib/search/similarity';
import type { GeocodeResult } from '../../../../../lib/geocode';

const DUP_THRESHOLD = 0.6; // Jaccard 2-gram + Levenshtein の合成スコア
const DUP_DEBOUNCE_MS = 600;

export default function CreateSpotScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { show } = useToastStore();
  const qc = useQueryClient();

  // 入力 state
  const [coord, setCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<SpotCategory>('work_setting');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  // マップ救済 modal
  const [mapOpen, setMapOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 既存 spot 取得 (重複検出用)
  const { data: existingSpots = [] } = useQuery({
    queryKey: ['community', id, 'spots'],
    queryFn: () => fetchCommunitySpots(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });

  // 重複候補 (debounce 後に再計算)
  const [debouncedName, setDebouncedName] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(name.trim()), DUP_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [name]);

  const similarSpots = useMemo(() => {
    const q = debouncedName;
    if (!q || q.length < 2 || existingSpots.length === 0) return [];
    // findSimilar は { name: string } を期待
    return findSimilar(q, existingSpots, { threshold: DUP_THRESHOLD, limit: 3 });
  }, [debouncedName, existingSpots]);

  // 候補から選択 (geocode or マップ救済 or 現在地)
  const handleSelectAddress = (r: GeocodeResult) => {
    setCoord({ lat: r.lat, lon: r.lon });
    // 名前が空なら自動 fill
    if (name.trim().length === 0) {
      setName(r.displayName);
    }
  };

  const canSubmit =
    coord !== null &&
    name.trim().length > 0 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !coord) return;
    setSubmitting(true);
    const { error } = await createSpot({
      community_id: id,
      name: name.trim(),
      description: description.trim() || undefined,
      lat: coord.lat,
      lon: coord.lon,
      category,
      photo_urls: photoUrls,
    });
    setSubmitting(false);
    if (error) {
      show(error, 'error');
      return;
    }
    show('聖地を登録しました', 'success');
    void qc.invalidateQueries({ queryKey: ['community', id, 'spots'] });
    router.back();
  };

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
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>聖地を追加</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
          gap: SP['5'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. 場所を検索 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallB, { color: C.text2 }]}>場所</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            施設名や住所を入力して候補から選択 (例: 東京ドーム / 渋谷区神南 1-1)
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
                位置が確定: {coord.lat.toFixed(5)}, {coord.lon.toFixed(5)}
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

        {/* 2. カテゴリ (必須) */}
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
                    gap: 4,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 6,
                    borderRadius: R.full,
                    backgroundColor: isSelected ? meta.color + '33' : C.bg3,
                    borderWidth: 1.5,
                    borderColor: isSelected ? meta.color : C.border,
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{meta.emoji}</Text>
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
        <View style={{ gap: SP['2'] }}>
          <Input
            label="名前 ★必須"
            placeholder="例: ○○神社"
            value={name}
            onChangeText={setName}
            maxLength={80}
          />
          {/* 重複警告 (登録は許可) */}
          {similarSpots.length > 0 && (
            <View
              style={{
                padding: SP['2'] + 2,
                backgroundColor: C.amberBg,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.amber + '55',
                gap: 4,
              }}
            >
              <Text style={[T.caption, { color: C.amber, fontWeight: '700' }]}>
                ⚠️ 似た名前の聖地が既に登録されています
              </Text>
              {similarSpots.map(({ item }) => (
                <Text key={item.id} style={[T.caption, { color: C.text2 }]} numberOfLines={1}>
                  ・{item.name}
                </Text>
              ))}
              <Text style={[T.caption, { color: C.text3 }]}>
                別物なら気にせず登録してください。
              </Text>
            </View>
          )}
        </View>

        {/* 4. 説明 (任意) */}
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

        {/* 5. 写真 (任意だが推奨) */}
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text style={[T.smallB, { color: C.text2, flex: 1 }]}>写真 (任意)</Text>
            <View
              style={{
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                backgroundColor: C.accentBg,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: C.accent + '55',
              }}
            >
              <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700' }}>
                📸 推奨
              </Text>
            </View>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            写真があると他のメンバーが見つけやすくなります (最大 4 枚)
          </Text>
          {/* 写真選択 UI は別 PR で完全実装。現状は URL 直接貼り付けの簡易 UI */}
          <Text style={[T.caption, { color: C.text3 }]}>
            (画像アップロード UI は次の PR で対応)
          </Text>
        </View>

        {/* Submit */}
        <Button
          label={submitting ? '登録中…' : '聖地を登録'}
          onPress={handleSubmit}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={submitting}
          haptic="confirm"
        />
        {!coord && (
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            まず上の検索で場所を確定してください
          </Text>
        )}
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
    </KeyboardAvoidingView>
  );
}
