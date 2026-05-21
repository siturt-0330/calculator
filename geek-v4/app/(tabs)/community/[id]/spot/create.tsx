// ============================================================
// 聖地作成 (community spot create)
// 後で本格的な地図ベース UI に差し替える前提だが、
// 最低限「名前 / 説明 / 座標」を入力して保存できるフォームを提供。
// 座標は数値入力 (lat / lon)。現在地ボタン (web: navigator.geolocation, native: 未対応で
// 警告のみ) と「マップで開く」プレビューリンクを提供する。
// ============================================================
import { View, Text, ScrollView, Platform, Linking, Pressable } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '../../../../../design/tokens';
import { T } from '../../../../../design/typography';
import { BackButton } from '../../../../../components/nav/BackButton';
import { Input } from '../../../../../components/ui/Input';
import { Button } from '../../../../../components/ui/Button';
import { Icon } from '../../../../../constants/icons';
import { useToastStore } from '../../../../../stores/toastStore';
import { createSpot } from '../../../../../lib/api/communities';
import { TABBAR } from '../../../../../design/tabbar';

export default function CreateSpotScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { show } = useToastStore();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [latStr, setLatStr] = useState('');
  const [lonStr, setLonStr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const lat = Number(latStr);
  const lon = Number(lonStr);
  const latValid = latStr.length > 0 && !Number.isNaN(lat) && lat >= -90 && lat <= 90;
  const lonValid = lonStr.length > 0 && !Number.isNaN(lon) && lon >= -180 && lon <= 180;
  const canSubmit = name.trim().length > 0 && latValid && lonValid && !submitting;

  const handleUseCurrentLocation = () => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.geolocation) {
      show('現在地の取得は web 版のみ対応しています', 'warn');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatStr(pos.coords.latitude.toFixed(6));
        setLonStr(pos.coords.longitude.toFixed(6));
        show('現在地を取得しました', 'success');
      },
      () => show('現在地の取得に失敗しました', 'error'),
      { timeout: 10000 },
    );
  };

  const handleOpenInMaps = () => {
    if (!latValid || !lonValid) return;
    const url = `https://www.google.com/maps?q=${lat},${lon}`;
    Linking.openURL(url).catch(() => show('マップを開けませんでした', 'error'));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const { error } = await createSpot({
      community_id: id,
      name: name.trim(),
      description: description.trim() || undefined,
      lat,
      lon,
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
    <View style={{ flex: 1, backgroundColor: C.bg }}>
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
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label="名前"
          placeholder="例: ○○神社"
          value={name}
          onChangeText={setName}
          maxLength={80}
        />
        <Input
          label="説明 (任意)"
          placeholder="どんな場所か、ファン的におすすめのポイントなど"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          maxLength={500}
          textAlignVertical="top"
        />

        {/* 座標 — Pressable な現在地ボタン付き */}
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text style={[T.small, { color: C.text2, flex: 1 }]}>座標</Text>
            <Pressable
              onPress={handleUseCurrentLocation}
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'],
                paddingVertical: 4,
                backgroundColor: C.accentBg,
                borderRadius: R.full,
              }}
            >
              <Icon.map size={12} color={C.accent} strokeWidth={2.4} />
              <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>
                現在地を使う
              </Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: SP['2'] }}>
            <View style={{ flex: 1 }}>
              <Input
                placeholder="緯度 (lat)"
                value={latStr}
                onChangeText={setLatStr}
                keyboardType="numbers-and-punctuation"
                error={latStr.length > 0 && !latValid ? '-90 〜 90 の範囲' : undefined}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                placeholder="経度 (lon)"
                value={lonStr}
                onChangeText={setLonStr}
                keyboardType="numbers-and-punctuation"
                error={lonStr.length > 0 && !lonValid ? '-180 〜 180 の範囲' : undefined}
              />
            </View>
          </View>
          {latValid && lonValid && (
            <Pressable
              onPress={handleOpenInMaps}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: SP['2'],
                paddingHorizontal: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Icon.map size={14} color={C.text2} strokeWidth={2.2} />
              <Text style={[T.small, { color: C.text2, flex: 1 }]} numberOfLines={1}>
                {lat.toFixed(5)}, {lon.toFixed(5)}
              </Text>
              <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
                マップで開く ↗
              </Text>
            </Pressable>
          )}
        </View>

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
      </ScrollView>
    </View>
  );
}
