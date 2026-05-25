// ============================================================
// geek-official — 聖地管理
// ============================================================
import { View, Text, ScrollView, Modal, TextInput, ActivityIndicator, Image, Platform } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Spinner } from '../../../components/ui/Spinner';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Icon } from '../../../constants/icons';
import { useToastStore } from '../../../stores/toastStore';
import { useAuthStore } from '../../../stores/authStore';
import {
  fetchCommunity,
  fetchCommunitySpots,
  createSpot,
  deleteSpot,
  toggleSpotCertified,
  type CommunitySpot,
} from '../../../lib/api/communities';
import { sanitizeUrl } from '../../../lib/sanitize';
import { formatRelative } from '../../../lib/utils/date';

export default function OfficialSpotsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const id = typeof params.communityId === 'string' ? params.communityId : '';
  const userId = useAuthStore((s) => s.user?.id);
  const { show } = useToastStore();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CommunitySpot | null>(null);

  // form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [latStr, setLatStr] = useState('');
  const [lonStr, setLonStr] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  const { data: community } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });
  const isAdmin = !!community && !!userId && community.official_admin_user_id === userId;

  const { data: spots = [], isLoading } = useQuery({
    queryKey: ['community', id, 'spots'],
    queryFn: () => fetchCommunitySpots(id),
    enabled: id.length > 0,
    staleTime: 20_000,
  });

  const create = useMutation({
    mutationFn: async () => {
      const lat = Number(latStr);
      const lon = Number(lonStr);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) throw new Error('緯度は -90 〜 90');
      if (Number.isNaN(lon) || lon < -180 || lon > 180) throw new Error('経度は -180 〜 180');
      const { data, error } = await createSpot({
        community_id: id,
        name: name.trim(),
        description: description.trim() || undefined,
        lat,
        lon,
        // migration 0045 で category 必須化。official 管理画面の旧 UI は
        // 一旦 'other' default で送る (UI 更新は別 PR で検討可)。
        category: 'other',
        photo_url: photoUrl.trim() || undefined,
      });
      if (error || !data) throw new Error(error ?? '聖地の登録に失敗しました');
      return data;
    },
    onSuccess: () => {
      show('聖地を登録しました', 'success');
      setModalOpen(false);
      setName(''); setDescription(''); setLatStr(''); setLonStr(''); setPhotoUrl('');
      void qc.invalidateQueries({ queryKey: ['community', id, 'spots'] });
    },
    onError: (e: unknown) => {
      show(e instanceof Error ? e.message : '登録に失敗しました', 'error');
    },
  });

  const remove = useMutation({
    mutationFn: async (spotId: string) => {
      const { error } = await deleteSpot(spotId);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['community', id, 'spots'] });
    },
    onError: (e: unknown) => show(e instanceof Error ? e.message : '削除に失敗しました', 'error'),
  });

  const toggleCertify = useMutation({
    mutationFn: ({ spotId, certified }: { spotId: string; certified: boolean }) =>
      toggleSpotCertified(spotId, certified),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['community', id, 'spots'] });
      show(vars.certified ? '公認に設定しました' : '公認を解除しました', 'success');
    },
    onError: (e: unknown) => show(e instanceof Error ? e.message : '公認設定に失敗しました', 'error'),
  });

  const lat = Number(latStr);
  const lon = Number(lonStr);
  const latValid = latStr.length > 0 && !Number.isNaN(lat) && lat >= -90 && lat <= 90;
  const lonValid = lonStr.length > 0 && !Number.isNaN(lon) && lon >= -180 && lon <= 180;
  const canSubmit = name.trim().length >= 1 && latValid && lonValid && !create.isPending;

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <BackButton />
        <EmptyState icon={Icon.lock} title="権限がありません" />
      </View>
    );
  }

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
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>聖地管理</Text>
        <PressableScale
          onPress={() => setModalOpen(true)}
          haptic="confirm"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
            backgroundColor: C.accent,
            borderRadius: R.full,
            ...SHADOW.accentGlow,
          }}
        >
          <Icon.plus size={14} color="#fff" strokeWidth={2.6} />
          <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>聖地追加</Text>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: insets.bottom + SP['16'],
          gap: SP['3'],
        }}
      >
        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : spots.length === 0 ? (
          <EmptyState
            icon={Icon.map}
            title="聖地がありません"
            message="このコミュニティに紐づく場所を追加して、メンバーにシェアしましょう"
            actionLabel="+ 聖地を追加"
            onAction={() => setModalOpen(true)}
            tone="green"
          />
        ) : (
          spots.map((s, i) => (
            <Animated.View key={s.id} entering={FadeInDown.delay(i * 30).duration(220)}>
              <SpotRow
                spot={s}
                busyCertify={toggleCertify.isPending && toggleCertify.variables?.spotId === s.id}
                busyDelete={remove.isPending && remove.variables === s.id}
                onToggleCertify={() => toggleCertify.mutate({ spotId: s.id, certified: !s.is_certified })}
                onDelete={() => setPendingDelete(s)}
              />
            </Animated.View>
          ))
        )}
      </ScrollView>

      {/* 追加モーダル */}
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
              <Text style={[T.h3, { color: C.text, flex: 1 }]}>聖地を追加</Text>
              <PressableScale onPress={() => setModalOpen(false)} haptic="tap" style={{ padding: 6 }}>
                <Icon.close size={20} color={C.text2} strokeWidth={2.4} />
              </PressableScale>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: SP['3'] }}>
              <Field label="名前">
                <TextInput value={name} onChangeText={setName} placeholder="例: ○○神社" placeholderTextColor={C.text3} style={fieldStyle} maxLength={80} />
              </Field>
              <Field label="説明 (任意)">
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="どんな場所か、おすすめポイント"
                  placeholderTextColor={C.text3}
                  multiline
                  style={[fieldStyle, { minHeight: Platform.OS === 'web' ? 90 : 70, textAlignVertical: 'top' }]}
                  maxLength={500}
                />
              </Field>
              <View style={{ flexDirection: 'row', gap: SP['2'] }}>
                <View style={{ flex: 1 }}>
                  <Field label="緯度 (lat)">
                    <TextInput
                      value={latStr}
                      onChangeText={setLatStr}
                      placeholder="35.6762"
                      placeholderTextColor={C.text3}
                      keyboardType="numbers-and-punctuation"
                      style={fieldStyle}
                    />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="経度 (lon)">
                    <TextInput
                      value={lonStr}
                      onChangeText={setLonStr}
                      placeholder="139.6503"
                      placeholderTextColor={C.text3}
                      keyboardType="numbers-and-punctuation"
                      style={fieldStyle}
                    />
                  </Field>
                </View>
              </View>
              <Field label="画像 URL (任意)">
                <TextInput value={photoUrl} onChangeText={setPhotoUrl} placeholder="https://..." placeholderTextColor={C.text3} autoCapitalize="none" autoCorrect={false} style={fieldStyle} />
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
        title="聖地を削除"
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

function SpotRow({
  spot, busyCertify, busyDelete, onToggleCertify, onDelete,
}: {
  spot: CommunitySpot;
  busyCertify: boolean;
  busyDelete: boolean;
  onToggleCertify: () => void;
  onDelete: () => void;
}) {
  const safePhoto = spot.photo_url ? sanitizeUrl(spot.photo_url) : null;
  return (
    <View
      style={[
        {
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: spot.is_certified ? C.accent + '55' : C.border,
          gap: SP['2'],
        },
        SHADOW.card,
      ]}
    >
      <View style={{ flexDirection: 'row', gap: SP['3'] }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: R.md,
            backgroundColor: C.bg3,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {safePhoto ? (
            <Image source={{ uri: safePhoto }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <Text style={{ fontSize: 28 }}>📍</Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[T.bodyB, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>{spot.name}</Text>
            {spot.is_certified && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 3,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  backgroundColor: C.accentBg,
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: C.accent + '55',
                }}
              >
                <Icon.shield size={10} color={C.accent} strokeWidth={2.6} />
                <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700' }}>公認</Text>
              </View>
            )}
          </View>
          {spot.description.length > 0 && (
            <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>{spot.description}</Text>
          )}
          <Text style={[T.caption, { color: C.text4 }]}>
            {spot.lat.toFixed(4)}, {spot.lon.toFixed(4)} · {formatRelative(spot.created_at)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end' }}>
        <PressableScale
          onPress={onToggleCertify}
          haptic="tap"
          disabled={busyCertify}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
            borderRadius: R.full,
            backgroundColor: spot.is_certified ? C.accentBg : C.bg3,
            borderWidth: 1,
            borderColor: spot.is_certified ? C.accent + '55' : C.border,
            opacity: busyCertify ? 0.6 : 1,
          }}
        >
          {busyCertify && <ActivityIndicator size="small" color={C.accent} />}
          <Icon.shield size={12} color={spot.is_certified ? C.accent : C.text2} strokeWidth={2.4} />
          <Text style={{ fontSize: 11, fontWeight: '700', color: spot.is_certified ? C.accentLight : C.text2 }}>
            {spot.is_certified ? '公認解除' : '公認にする'}
          </Text>
        </PressableScale>
        <PressableScale
          onPress={onDelete}
          haptic="warn"
          disabled={busyDelete}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
            borderRadius: R.full,
            backgroundColor: C.redBg,
            borderWidth: 1,
            borderColor: C.red + '55',
            opacity: busyDelete ? 0.6 : 1,
          }}
        >
          <Icon.trash size={12} color={C.red} strokeWidth={2.4} />
          <Text style={{ fontSize: 11, fontWeight: '700', color: C.red }}>削除</Text>
        </PressableScale>
      </View>
    </View>
  );
}
