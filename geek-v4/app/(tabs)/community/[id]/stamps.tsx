// ============================================================
// Community stamps management screen
// ============================================================
// Route: /community/[id]/stamps
//
// 仕様:
//   - コミュメンバーのみがスタンプを作成できる
//   - 作成済みスタンプは全メンバーに見える (RLS で open / request / member 条件)
//   - 作成者本人 / コミュオーナーが削除できる
//   - 同コミュ内で label の重複は禁止 (DB unique)
// ============================================================

import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { C, R, SP } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { TABBAR } from '../../../../design/tabbar';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { BackButton } from '../../../../components/nav/BackButton';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Spinner } from '../../../../components/ui/Spinner';
import { Icon } from '../../../../constants/icons';
import { useQuery } from '@tanstack/react-query';
import { fetchCommunity } from '../../../../lib/api/communities';
import {
  useCommunityStamps,
  useCreateCommunityStamp,
  useDeleteCommunityStamp,
  type CommunityStamp,
} from '../../../../hooks/useCommunityStamps';
import { useAuthStore } from '../../../../stores/authStore';
import { useToastStore } from '../../../../stores/toastStore';

export default function CommunityStampsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { show } = useToastStore();

  const communityQ = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: !!id,
    staleTime: 60_000,
  });
  const community = communityQ.data;
  const isMember = !!community?.is_member;
  const isOwner = community?.role === 'owner';

  const stampsQ = useCommunityStamps(id);
  const stamps: CommunityStamp[] = stampsQ.data ?? [];

  const createMut = useCreateCommunityStamp(id);
  const deleteMut = useDeleteCommunityStamp(id);

  const [label, setLabel] = useState('');

  const submit = () => {
    const t = label.trim();
    if (t.length < 1) {
      show('スタンプの文字を入力してください', 'warn');
      return;
    }
    if (t.length > 40) {
      show('スタンプは 40 文字以内にしてください', 'warn');
      return;
    }
    if (!isMember) {
      show('コミュニティのメンバーのみが作成できます', 'warn');
      return;
    }
    createMut.mutate(
      { label: t },
      {
        onSuccess: () => setLabel(''),
      },
    );
  };

  const canDelete = (stamp: CommunityStamp) =>
    isOwner || stamp.creator_id === user?.id;

  // 自分が作成したスタンプの数 (UI ヒント)
  const myStampCount = useMemo(
    () => stamps.filter((s) => s.creator_id === user?.id).length,
    [stamps, user?.id],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <BackButton />
        <View style={{ flex: 1 }}>
          <Text style={[T.h3, { color: C.text }]} numberOfLines={1}>
            コミュニティスタンプ
          </Text>
          {community && (
            <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
              {community.name}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          gap: SP['4'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 説明 */}
        <View
          style={{
            padding: SP['3'],
            backgroundColor: C.accentBg,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.accentSoft,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon.sparkles size={14} color={C.accent} strokeWidth={2.4} />
            <Text style={[T.smallM, { color: C.accent, fontWeight: '700' }]}>
              このコミュ専用スタンプ
            </Text>
          </View>
          <Text style={[T.caption, { color: C.text2, lineHeight: 16 }]}>
            このコミュニティのメンバーが作成・利用できるスタンプです。
            コミュニティに投稿された投稿にだけ使えます。
          </Text>
        </View>

        {/* 作成フォーム (メンバーのみ) */}
        {isMember ? (
          <View style={{ gap: SP['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['1'] }}>
              <Text style={[T.smallB, { color: C.text2 }]}>新しいスタンプを作る</Text>
              <View style={{ flex: 1 }} />
              <Text style={[T.caption, { color: label.length > 38 ? C.amber : C.text3 }]}>
                {label.length} / 40
              </Text>
            </View>
            <Input
              value={label}
              onChangeText={setLabel}
              placeholder="例: おつかれ / 草 / 🎉"
              maxLength={40}
              keyboardAppearance="dark"
              selectionColor={C.accent}
              onSubmitEditing={submit}
              returnKeyType="done"
            />
            <Button
              label="スタンプを作成"
              onPress={submit}
              loading={createMut.isPending}
              disabled={createMut.isPending || label.trim().length < 1}
              haptic="confirm"
            />
            {myStampCount > 0 && (
              <Text style={[T.caption, { color: C.text3, textAlign: 'right' }]}>
                あなたが作ったスタンプ: {myStampCount} 個
              </Text>
            )}
          </View>
        ) : (
          <View
            style={{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }}
          >
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>
              スタンプ作成にはメンバー登録が必要です
            </Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              コミュニティに参加すると、スタンプの作成と利用ができるようになります。
            </Text>
            <PressableScale
              onPress={() => router.push(`/community/${id}` as never)}
              haptic="tap"
              style={{
                marginTop: SP['1'],
                paddingHorizontal: SP['4'],
                paddingVertical: SP['2'],
                backgroundColor: C.accent,
                borderRadius: R.full,
                alignItems: 'center',
              }}
            >
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
                コミュニティに参加する
              </Text>
            </PressableScale>
          </View>
        )}

        {/* スタンプ一覧 */}
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={[T.smallB, { color: C.text2 }]}>スタンプ一覧</Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              ({stamps.length})
            </Text>
          </View>
          {stampsQ.isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: SP['8'] }}>
              <Spinner size="large" />
            </View>
          ) : stamps.length === 0 ? (
            <EmptyState
              icon={Icon.sparkles}
              title="まだスタンプがありません"
              message={
                isMember
                  ? '上のフォームから最初のスタンプを作ろう。'
                  : 'メンバーが作ったスタンプがここに表示されます。'
              }
            />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {stamps.map((s) => (
                <Animated.View key={s.id} entering={FadeIn.duration(180)}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingLeft: SP['3'],
                      paddingRight: 6,
                      paddingVertical: 6,
                      backgroundColor: C.bg2,
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>{s.label}</Text>
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        backgroundColor: C.bg3,
                        borderRadius: R.full,
                      }}
                    >
                      <Text style={[T.caption, { color: C.text3, fontWeight: '700', fontSize: 10 }]}>
                        {s.use_count.toLocaleString('ja-JP')}
                      </Text>
                    </View>
                    {canDelete(s) && (
                      <PressableScale
                        onPress={() =>
                          deleteMut.mutate(s.id)
                        }
                        haptic="warn"
                        hitSlop={6}
                        accessibilityLabel={`スタンプ ${s.label} を削除`}
                        disabled={deleteMut.isPending}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: C.bg3,
                        }}
                      >
                        <Icon.close size={12} color={C.text3} strokeWidth={2.4} />
                      </PressableScale>
                    )}
                  </View>
                </Animated.View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
