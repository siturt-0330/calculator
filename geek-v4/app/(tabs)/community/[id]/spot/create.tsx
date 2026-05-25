// ============================================================
// 聖地登録 (community spot create) — 2026-05 UI ポリッシュ
// ------------------------------------------------------------
// 入力: 場所 / カテゴリ / 名前 / 説明 / (将来) 写真
//
// デザイン:
//   - 各セクションをカード化 (背景 C.bg2 + border)
//   - 必須 / 任意 / 推奨 を右肩 badge で明示 (★必須 のテキストを廃止)
//   - カテゴリ chip は 2 列 × 4 行で固定幅 (はみ出しなし)
//   - 場所カードは「未確定 / 確定」で表示を切替 (ノイズを減らす)
//   - 登録ボタンは sticky bottom (常時見える)
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
  const [coordLabel, setCoordLabel] = useState<string>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<SpotCategory>('work_setting');
  const [photoUrls] = useState<string[]>([]);

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
    return findSimilar(q, existingSpots, { threshold: DUP_THRESHOLD, limit: 3 });
  }, [debouncedName, existingSpots]);

  // 候補から選択 (geocode or マップ救済 or 現在地)
  const handleSelectAddress = (r: GeocodeResult) => {
    setCoord({ lat: r.lat, lon: r.lon });
    setCoordLabel(r.displayName);
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
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
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
          paddingTop: SP['2'],
          paddingBottom: TABBAR.height + insets.bottom + SP['24'], // sticky CTA 分のスペース
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ───────── 1. 場所 ───────── */}
        <Card>
          <SectionHeader title="場所" badge={{ kind: 'required' }} />

          {coord ? (
            // 確定後の表示 — 情報を圧縮
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                padding: SP['3'],
                backgroundColor: C.greenBg,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.green + '55',
              }}
            >
              <View
                style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: C.green + '22',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon.shield size={14} color={C.green} strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[T.smallB, { color: C.green }]} numberOfLines={1}>
                  位置を確定しました
                </Text>
                <Text style={[T.caption, { color: C.text2 }]} numberOfLines={1}>
                  {coordLabel || `${coord.lat.toFixed(5)}, ${coord.lon.toFixed(5)}`}
                </Text>
              </View>
              <PressableScale
                onPress={() => {
                  setCoord(null);
                  setCoordLabel('');
                }}
                haptic="tap"
                hitSlop={6}
                accessibilityLabel="位置をクリア"
                style={{ padding: 6 }}
              >
                <Icon.close size={14} color={C.text3} strokeWidth={2.4} />
              </PressableScale>
              <PressableScale
                onPress={() => setMapOpen(true)}
                haptic="tap"
                style={{
                  paddingHorizontal: SP['3'],
                  paddingVertical: 6,
                  borderRadius: R.full,
                  backgroundColor: C.bg2,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
                  調整
                </Text>
              </PressableScale>
            </View>
          ) : (
            // 未確定 — 検索 UI
            <View style={{ gap: SP['2'] }}>
              <AddressSearch
                onSelect={handleSelectAddress}
                onMapFallback={() => setMapOpen(true)}
              />
              <Text style={[T.caption, { color: C.text3 }]}>
                施設名や住所で検索 (例: 東京ドーム / 渋谷区神南 1-1)
              </Text>
            </View>
          )}
        </Card>

        {/* ───────── 2. カテゴリ ───────── */}
        <Card>
          <SectionHeader title="カテゴリ" badge={{ kind: 'required' }} />
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              marginHorizontal: -SP['1'],
              marginTop: SP['1'],
            }}
          >
            {SELECTABLE_SPOT_CATEGORIES.map((c) => {
              const meta = SPOT_CATEGORY_META[c];
              const isSelected = category === c;
              return (
                <View
                  key={c}
                  style={{
                    width: '50%',
                    padding: SP['1'],
                  }}
                >
                  <PressableScale
                    onPress={() => setCategory(c)}
                    haptic="select"
                    hitSlop={4}
                    accessibilityLabel={`${meta.label} を選択`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SP['2'],
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['2'] + 2,
                      borderRadius: R.lg,
                      backgroundColor: isSelected ? meta.color + '22' : C.bg3,
                      borderWidth: 1.5,
                      borderColor: isSelected ? meta.color : 'transparent',
                    }}
                  >
                    <View
                      style={{
                        width: 28, height: 28, borderRadius: 14,
                        backgroundColor: isSelected ? meta.color + '33' : C.bg2,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 14 }}>{meta.emoji}</Text>
                    </View>
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 13,
                        color: isSelected ? meta.color : C.text,
                        fontWeight: isSelected ? '700' : '600',
                      }}
                      numberOfLines={1}
                    >
                      {meta.label}
                    </Text>
                  </PressableScale>
                </View>
              );
            })}
          </View>
        </Card>

        {/* ───────── 3. 名前 ───────── */}
        <Card>
          <SectionHeader
            title="名前"
            badge={{ kind: 'required' }}
            right={
              <Text style={[T.caption, { color: name.length > 70 ? C.amber : C.text3 }]}>
                {name.length} / 80
              </Text>
            }
          />
          <Input
            placeholder="例: ○○神社"
            value={name}
            onChangeText={setName}
            maxLength={80}
          />
          {similarSpots.length > 0 && (
            <View
              style={{
                padding: SP['3'],
                backgroundColor: C.amberBg,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.amber + '55',
                gap: 4,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon.warn size={12} color={C.amber} strokeWidth={2.4} />
                <Text style={[T.caption, { color: C.amber, fontWeight: '700' }]}>
                  似た名前の聖地が登録済み
                </Text>
              </View>
              {similarSpots.map(({ item }) => (
                <Text key={item.id} style={[T.caption, { color: C.text2, paddingLeft: 18 }]} numberOfLines={1}>
                  · {item.name}
                </Text>
              ))}
              <Text style={[T.caption, { color: C.text3, paddingLeft: 18 }]}>
                別物ならそのまま登録してください
              </Text>
            </View>
          )}
        </Card>

        {/* ───────── 4. 説明 ───────── */}
        <Card>
          <SectionHeader
            title="説明"
            badge={{ kind: 'optional' }}
            right={
              <Text style={[T.caption, { color: description.length > 450 ? C.amber : C.text3 }]}>
                {description.length} / 500
              </Text>
            }
          />
          <Input
            placeholder="どんな場所か、おすすめポイントなど"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={500}
            textAlignVertical="top"
          />
        </Card>

        {/* ───────── 5. 写真 ───────── */}
        <Card>
          <SectionHeader
            title="写真"
            badge={{ kind: 'recommended' }}
          />
          <Text style={[T.caption, { color: C.text3, marginBottom: SP['1'] }]}>
            写真があると他のメンバーが見つけやすくなります (最大 4 枚)
          </Text>
          <View
            style={{
              padding: SP['4'],
              backgroundColor: C.bg3,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              borderStyle: 'dashed',
              alignItems: 'center',
              gap: SP['1'],
            }}
          >
            <Icon.image size={28} color={C.text3} strokeWidth={1.8} />
            <Text style={[T.small, { color: C.text3 }]}>
              画像アップロード UI は次の PR で対応
            </Text>
          </View>
        </Card>
      </ScrollView>

      {/* ───────── Sticky CTA ───────── */}
      <View
        style={{
          position: 'absolute',
          left: 0, right: 0,
          bottom: 0,
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: insets.bottom + SP['3'],
          backgroundColor: C.bg,
          borderTopWidth: 1,
          borderTopColor: C.border,
          gap: SP['2'],
        }}
      >
        {!coord && (
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            まず上の検索で場所を確定してください
          </Text>
        )}
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
      </View>

      <SpotMapPicker
        visible={mapOpen}
        initialCoord={coord ?? undefined}
        onConfirm={(c) => {
          setCoord(c);
          setCoordLabel(`${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`);
          setMapOpen(false);
        }}
        onClose={() => setMapOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

// ============================================================
// 小物コンポーネント (このファイル限定 — 他で使うなら ui/ に切出し)
// ============================================================

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
      }}
    >
      {children}
    </View>
  );
}

type BadgeKind = 'required' | 'optional' | 'recommended';

function SectionHeader({
  title,
  badge,
  right,
}: {
  title: string;
  badge?: { kind: BadgeKind };
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
      <Text style={[T.bodyB, { color: C.text, fontWeight: '700' }]}>{title}</Text>
      {badge && <Badge kind={badge.kind} />}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

function Badge({ kind }: { kind: BadgeKind }) {
  const meta = {
    required:    { label: '必須', fg: C.red,    bg: C.red + '22',    border: C.red + '44' },
    optional:    { label: '任意', fg: C.text3,  bg: C.bg3,           border: C.border },
    recommended: { label: '推奨', fg: C.accent, bg: C.accentBg,      border: C.accent + '55' },
  }[kind];
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: R.full,
        backgroundColor: meta.bg,
        borderWidth: 1,
        borderColor: meta.border,
      }}
    >
      <Text style={{ fontSize: 10, color: meta.fg, fontWeight: '700' }}>
        {meta.label}
      </Text>
    </View>
  );
}
