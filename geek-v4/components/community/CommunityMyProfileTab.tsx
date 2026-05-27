// ============================================================
// components/community/CommunityMyProfileTab.tsx
// ------------------------------------------------------------
// migration 0047 で導入した community_member_profiles を表示・編集する
// コミュ内マイプロフタブ (oshi 系コミュ向け)。
//
// 表示モード:
//   - 自分のレコードが無ければ「プロフィールを書く」CTA を出す
//   - レコードがあれば 最推し / 推し歴 / 参戦数 / マイセトリ をカード表示
//   - 「編集」ボタンで modal を開いて編集
//
// 設計判断:
//   - サブ画面ではなく tab 内に inline で描く (community 詳細から離脱しない)
//   - 編集は Modal (= 既存 UX と一致)
//   - my_setlist は 1 行 1 項目の text input 列で追加 / 削除
// ============================================================
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { useToastStore } from '../../stores/toastStore';
import {
  fetchMyMemberProfile,
  upsertMyMemberProfile,
  formatOshiSince,
  type CommunityMemberProfile,
} from '../../lib/api/communityMemberProfiles';

export function CommunityMyProfileTab({
  communityId,
  isMember,
}: {
  communityId: string;
  isMember: boolean;
}) {
  const qc = useQueryClient();
  const { show } = useToastStore();
  const [editOpen, setEditOpen] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['community', communityId, 'my-profile'],
    queryFn: () => fetchMyMemberProfile(communityId),
    enabled: communityId.length > 0 && isMember,
    staleTime: 60_000,
  });

  if (!isMember) {
    return (
      <View style={{ padding: SP['6'], gap: SP['3'], alignItems: 'center' }}>
        {/* 装飾絵文字 (🪪) 撤去 */}
        <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>
          コミュニティに参加するとマイプロフが使えます
        </Text>
        <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
          最推し・推し歴・参戦数・セトリを記録して、同じ推しのメンバーと
          深く繋がれます。
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={{ padding: SP['10'], alignItems: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={{ paddingTop: SP['3'], paddingHorizontal: SP['4'], gap: SP['4'] }}>
      {profile ? (
        <ProfileView profile={profile} onEdit={() => setEditOpen(true)} />
      ) : (
        <EmptyProfileCta onCreate={() => setEditOpen(true)} />
      )}

      <ProfileEditModal
        visible={editOpen}
        communityId={communityId}
        initial={profile ?? null}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          show('プロフィールを保存しました', 'success');
          setEditOpen(false);
          void qc.invalidateQueries({ queryKey: ['community', communityId, 'my-profile'] });
        }}
      />
    </View>
  );
}

// ============================================================
// 表示
// ============================================================
function ProfileView({
  profile,
  onEdit,
}: {
  profile: CommunityMemberProfile;
  onEdit: () => void;
}) {
  const oshiHistory = formatOshiSince(profile.oshi_since);
  return (
    <View style={{ gap: SP['3'] }}>
      {/* 最推し ヒーロー */}
      <View
        style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.accent + '55',
          gap: SP['2'],
        }}
      >
        <Text style={[T.caption, { color: C.accent, fontWeight: '700', letterSpacing: 1 }]}>
          最推し
        </Text>
        <Text style={[T.h2, { color: C.text }]}>
          {profile.top_oshi || '— (未設定)'}
        </Text>
        {oshiHistory && (
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: SP['2'] + 2,
              paddingVertical: 3,
              backgroundColor: C.accentBg,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.accent + '55',
            }}
          >
            <Icon.heart size={11} color={C.accent} strokeWidth={2.6} />
            <Text style={{ fontSize: 11, color: C.accent, fontWeight: '700' }}>
              {oshiHistory}
            </Text>
          </View>
        )}
      </View>

      {/* KPI 行 */}
      <View style={{ flexDirection: 'row', gap: SP['2'] }}>
        <KpiBox
          icon="🎤"
          label="参戦数"
          value={profile.attended_count.toString()}
          unit="回"
        />
        <KpiBox
          icon="🎶"
          label="マイセトリ"
          value={profile.my_setlist.length.toString()}
          unit="曲"
        />
      </View>

      {/* マイセトリ */}
      <View
        style={{
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          gap: SP['2'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>🎶</Text>
          <Text style={[T.smallB, { color: C.text2, flex: 1 }]}>マイセトリ</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            {profile.my_setlist.length}/50
          </Text>
        </View>
        {profile.my_setlist.length === 0 ? (
          <Text style={[T.small, { color: C.text3 }]}>
            セトリを追加すると、推しの楽曲・イベントを記録できます
          </Text>
        ) : (
          <View style={{ gap: 4 }}>
            {profile.my_setlist.map((item, i) => (
              <Text key={`${i}-${item}`} style={[T.small, { color: C.text }]}>
                {i + 1}. {item}
              </Text>
            ))}
          </View>
        )}
      </View>

      <PressableScale
        onPress={onEdit}
        haptic="tap"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: SP['2'] + 2,
          backgroundColor: C.bg3,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Icon.edit size={14} color={C.text2} strokeWidth={2.4} />
        <Text style={[T.smallB, { color: C.text2, fontWeight: '700' }]}>編集</Text>
      </PressableScale>
    </View>
  );
}

function KpiBox({ icon, label, value, unit }: { icon: string; label: string; value: string; unit: string }) {
  return (
    <View
      style={{
        flex: 1,
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: 2,
      }}
    >
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
        <Text style={[T.h3, { color: C.text }]}>{value}</Text>
        <Text style={[T.caption, { color: C.text3 }]}>{unit}</Text>
      </View>
    </View>
  );
}

// ============================================================
// 空状態 CTA
// ============================================================
function EmptyProfileCta({ onCreate }: { onCreate: () => void }) {
  return (
    <View
      style={{
        padding: SP['6'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
        alignItems: 'center',
      }}
    >
      {/* 装飾絵文字 (🪪) 撤去 */}
      <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>
        マイプロフィールを書こう
      </Text>
      <Text style={[T.caption, { color: C.text3, textAlign: 'center', lineHeight: 18 }]}>
        匿名は維持したまま、{'\n'}
        最推し・推し歴・参戦数・マイセトリを記録。{'\n'}
        同じ推しのメンバーと深く繋がれます。
      </Text>
      <PressableScale
        onPress={onCreate}
        haptic="confirm"
        style={{
          marginTop: SP['2'],
          paddingHorizontal: SP['5'],
          paddingVertical: SP['3'],
          backgroundColor: C.accent,
          borderRadius: R.full,
        }}
      >
        <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>
          プロフィールを書く
        </Text>
      </PressableScale>
    </View>
  );
}

// ============================================================
// 編集 Modal
// ============================================================
function ProfileEditModal({
  visible,
  communityId,
  initial,
  onClose,
  onSaved,
}: {
  visible: boolean;
  communityId: string;
  initial: CommunityMemberProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();

  const [topOshi, setTopOshi] = useState('');
  const [oshiSince, setOshiSince] = useState('');
  const [attended, setAttended] = useState('0');
  const [setlist, setSetlist] = useState<string[]>([]);
  const [setlistDraft, setSetlistDraft] = useState('');

  // visible が立った時に initial で hydrate
  useEffect(() => {
    if (!visible) return;
    setTopOshi(initial?.top_oshi ?? '');
    setOshiSince(initial?.oshi_since ?? '');
    setAttended(String(initial?.attended_count ?? 0));
    setSetlist(initial?.my_setlist ?? []);
    setSetlistDraft('');
  }, [visible, initial]);

  const save = useMutation({
    mutationFn: () =>
      upsertMyMemberProfile({
        community_id: communityId,
        top_oshi: topOshi,
        oshi_since: oshiSince || null,
        attended_count: Number.parseInt(attended || '0', 10) || 0,
        my_setlist: setlist,
      }),
    onSuccess: ({ error }) => {
      if (error) {
        show(error, 'error');
        return;
      }
      onSaved();
    },
    onError: () => show('保存に失敗しました', 'error'),
  });

  const addSetlist = () => {
    const v = setlistDraft.trim();
    if (!v) return;
    if (setlist.length >= 50) {
      show('セトリは 50 件までです', 'error');
      return;
    }
    setSetlist((prev) => [...prev, v]);
    setSetlistDraft('');
  };

  const removeSetlist = (i: number) => {
    setSetlist((prev) => prev.filter((_, idx) => idx !== i));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: C.bg2,
            borderTopLeftRadius: R['2xl'],
            borderTopRightRadius: R['2xl'],
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['4'],
            maxHeight: '90%',
            gap: SP['3'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text style={[T.h3, { color: C.text, flex: 1 }]}>マイプロフィールを編集</Text>
            <PressableScale
              onPress={onClose}
              haptic="tap"
              hitSlop={12}
              accessibilityLabel="閉じる"
              style={{ padding: SP['2'] }}
            >
              <Icon.close size={20} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: SP['3'] }}>
            <Field label="最推し (例: 湊あくあ / 花澤香菜 / Vaundy)">
              <TextInput
                value={topOshi}
                onChangeText={setTopOshi}
                placeholder="名前を入力"
                placeholderTextColor={C.text3}
                style={fieldStyle}
                maxLength={100}
              />
            </Field>

            <Field label="推しはじめた日 (例: 2022-04-01)">
              <TextInput
                value={oshiSince}
                onChangeText={setOshiSince}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={C.text3}
                style={fieldStyle}
                autoCapitalize="none"
                autoCorrect={false}
                // memory DoS 対策: 日付 string は 10 文字 (YYYY-MM-DD)
                maxLength={10}
              />
            </Field>

            <Field label="参戦数 (ライブ・イベント)">
              <TextInput
                value={attended}
                onChangeText={(v) => setAttended(v.replace(/[^0-9]/g, ''))}
                placeholder="0"
                placeholderTextColor={C.text3}
                keyboardType="numeric"
                style={fieldStyle}
                maxLength={4}
              />
            </Field>

            <Field label={`マイセトリ (${setlist.length}/50)`}>
              <View style={{ gap: 4 }}>
                {setlist.map((item, i) => (
                  <View
                    key={`${i}-${item}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      padding: SP['2'],
                      backgroundColor: C.bg3,
                      borderRadius: R.md,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={[T.small, { color: C.text, flex: 1 }]} numberOfLines={2}>
                      {i + 1}. {item}
                    </Text>
                    <PressableScale
                      onPress={() => removeSetlist(i)}
                      haptic="warn"
                      hitSlop={6}
                      accessibilityLabel="削除"
                      style={{ padding: 4 }}
                    >
                      <Icon.close size={14} color={C.text3} strokeWidth={2.4} />
                    </PressableScale>
                  </View>
                ))}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <TextInput
                    value={setlistDraft}
                    onChangeText={setSetlistDraft}
                    onSubmitEditing={addSetlist}
                    placeholder="楽曲名・イベント名"
                    placeholderTextColor={C.text3}
                    style={[fieldStyle, { flex: 1 }]}
                    maxLength={200}
                    returnKeyType="done"
                  />
                  <PressableScale
                    onPress={addSetlist}
                    haptic="tap"
                    disabled={!setlistDraft.trim() || setlist.length >= 50}
                    style={{
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['3'],
                      backgroundColor: C.accent,
                      borderRadius: R.md,
                      opacity: setlistDraft.trim() && setlist.length < 50 ? 1 : 0.4,
                    }}
                  >
                    <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
                  </PressableScale>
                </View>
              </View>
            </Field>
          </ScrollView>

          <PressableScale
            onPress={() => save.mutate()}
            disabled={save.isPending}
            haptic="confirm"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: SP['3'],
              backgroundColor: save.isPending ? C.bg4 : C.accent,
              borderRadius: R.md,
            }}
          >
            {save.isPending && <ActivityIndicator size="small" color="#fff" />}
            <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>
              {save.isPending ? '保存中…' : '保存する'}
            </Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
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
