// ============================================================
// Admin: 公式コミュニティ申請 inbox
// ============================================================
// pending な申請を一覧表示。タップで詳細パネル → 承認 / 却下。
// 却下は理由 (≥5 文字) が必須。
// ============================================================
import { View, Text, ScrollView, Modal, TextInput, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { Icon } from '../../constants/icons';
import { useToastStore } from '../../stores/toastStore';
import {
  fetchPendingOfficialApps,
  approveOfficialApplication,
  rejectOfficialApplication,
  type AdminPendingApp,
} from '../../lib/api/officialCommunities';
import { formatRelative } from '../../lib/utils/date';

const FEATURE_LABEL: Record<string, string> = {
  qna: 'Q&A',
  calendar: 'カレンダー',
  map: '地図',
};

export default function AdminOfficialAppsScreen() {
  const insets = useSafeAreaInsets();
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();

  const [openApp, setOpenApp] = useState<AdminPendingApp | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [approveNotes, setApproveNotes] = useState('');

  const { data: apps = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-pending-official-apps'],
    queryFn: fetchPendingOfficialApps,
    staleTime: 20_000,
  });

  const approve = useMutation({
    mutationFn: (a: AdminPendingApp) => approveOfficialApplication(a.id, approveNotes),
    onSuccess: () => {
      show('承認しました', 'success');
      setOpenApp(null);
      setApproveNotes('');
      void qc.invalidateQueries({ queryKey: ['admin-pending-official-apps'] });
    },
    onError: (e: unknown) => show(e instanceof Error ? e.message : '承認に失敗しました', 'error'),
  });

  const reject = useMutation({
    mutationFn: (a: AdminPendingApp) => rejectOfficialApplication(a.id, rejectReason),
    onSuccess: () => {
      show('却下しました', 'warn');
      setOpenApp(null);
      setRejectMode(false);
      setRejectReason('');
      void qc.invalidateQueries({ queryKey: ['admin-pending-official-apps'] });
    },
    onError: (e: unknown) => show(e instanceof Error ? e.message : '却下に失敗しました', 'error'),
  });

  const canReject = rejectReason.trim().length >= 5 && !reject.isPending;

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
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>公式申請</Text>
        <PressableScale
          onPress={() => void refetch()}
          haptic="tap"
          hitSlop={10}
          style={{
            width: 34, height: 34, borderRadius: R.full,
            backgroundColor: C.bg3, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: C.border,
          }}
          accessibilityLabel="再読み込み"
        >
          <Icon.sparkles size={14} color={C.text2} strokeWidth={2.2} />
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: insets.bottom + SP['16'],
          gap: SP['2'],
        }}
      >
        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : apps.length === 0 ? (
          <EmptyState
            icon={Icon.check}
            title="未対応の申請はありません"
            message="新しい申請が来るとここに表示されます"
            tone="green"
          />
        ) : (
          apps.map((a, i) => (
            <Animated.View key={a.id} entering={FadeInDown.delay(i * 30).duration(220)}>
              <PressableScale
                onPress={() => { setOpenApp(a); setRejectMode(false); setRejectReason(''); setApproveNotes(''); }}
                haptic="tap"
                scaleValue={0.98}
                style={[{
                  padding: SP['3'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  gap: SP['2'],
                }, SHADOW.card]}
              >
                <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
                  <View
                    style={{
                      width: 44, height: 44, borderRadius: 22,
                      backgroundColor: a.icon_color,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{a.icon_emoji}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>{a.community_name}</Text>
                    <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                      申請者: {a.applicant_real_name} · {a.applicant_organization}
                    </Text>
                  </View>
                  <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(a.created_at)}</Text>
                </View>

                <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
                  {a.purpose}
                </Text>

                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <VerificationBadge status={a.verification_status} />
                  {a.requested_features.map((f) => (
                    <View
                      key={f}
                      style={{
                        paddingHorizontal: SP['2'],
                        paddingVertical: 2,
                        backgroundColor: C.accentBg,
                        borderRadius: R.sm,
                        borderWidth: 1,
                        borderColor: C.accent + '55',
                      }}
                    >
                      <Text style={{ color: C.accentLight, fontSize: 10, fontWeight: '700' }}>
                        {FEATURE_LABEL[f] ?? f}
                      </Text>
                    </View>
                  ))}
                </View>
              </PressableScale>
            </Animated.View>
          ))
        )}
      </ScrollView>

      {/* 詳細 + アクション モーダル */}
      <Modal visible={openApp !== null} transparent animationType="fade" onRequestClose={() => setOpenApp(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <Animated.View
            entering={FadeIn.duration(180)}
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R['2xl'],
              borderTopRightRadius: R['2xl'],
              padding: SP['4'],
              paddingBottom: insets.bottom + SP['4'],
              gap: SP['3'],
              maxHeight: '92%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.h3, { color: C.text, flex: 1 }]} numberOfLines={1}>
                {openApp?.community_name ?? '申請詳細'}
              </Text>
              <PressableScale
                onPress={() => setOpenApp(null)}
                haptic="tap"
                hitSlop={12}
                accessibilityLabel="閉じる"
                style={{ padding: 6 }}
              >
                <Icon.close size={20} color={C.text2} strokeWidth={2.4} />
              </PressableScale>
            </View>

            {openApp && (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: SP['3'] }}>
                <DetailRow label="申請者 (実名)" value={openApp.applicant_real_name} />
                <DetailRow label="所属組織" value={openApp.applicant_organization} />
                {openApp.applicant_email && <DetailRow label="メール" value={openApp.applicant_email} />}
                {openApp.applicant_url && <DetailRow label="URL" value={openApp.applicant_url} />}
                {openApp.applicant_url && (
                  <View style={{ gap: 4 }}>
                    <Text style={[T.caption, { color: C.text3, letterSpacing: 0.6 }]}>URL 所有確認</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <VerificationBadge status={openApp.verification_status} />
                      {openApp.verification_method && (
                        <Text style={[T.caption, { color: C.text3 }]}>
                          method: {openApp.verification_method}
                        </Text>
                      )}
                    </View>
                  </View>
                )}
                <DetailRow label="メンバー / 投稿" value={`${openApp.member_count} 人 / ${openApp.post_count} 投稿`} />
                <DetailRow label="申請日" value={new Date(openApp.created_at).toLocaleString('ja-JP')} />
                <View style={{ gap: 4 }}>
                  <Text style={[T.caption, { color: C.text3, letterSpacing: 0.6 }]}>申請理由</Text>
                  <View
                    style={{
                      padding: SP['3'],
                      backgroundColor: C.bg3,
                      borderRadius: R.md,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={[T.body, { color: C.text }]}>{openApp.purpose}</Text>
                  </View>
                </View>
                <View style={{ gap: 4 }}>
                  <Text style={[T.caption, { color: C.text3, letterSpacing: 0.6 }]}>利用したい機能</Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {openApp.requested_features.length === 0 ? (
                      <Text style={[T.small, { color: C.text3 }]}>(なし — 投稿のみ)</Text>
                    ) : (
                      openApp.requested_features.map((f) => (
                        <View
                          key={f}
                          style={{
                            paddingHorizontal: SP['2'],
                            paddingVertical: 3,
                            backgroundColor: C.accentBg,
                            borderRadius: R.full,
                            borderWidth: 1,
                            borderColor: C.accent + '55',
                          }}
                        >
                          <Text style={{ color: C.accentLight, fontSize: 11, fontWeight: '700' }}>
                            {FEATURE_LABEL[f] ?? f}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                </View>

                {rejectMode ? (
                  <View style={{ gap: 4 }}>
                    <Text style={[T.caption, { color: C.text3, letterSpacing: 0.6 }]}>却下理由 (≥5 文字)</Text>
                    <TextInput
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      placeholder="本人確認ができない、申請内容が不十分など"
                      placeholderTextColor={C.text3}
                      multiline
                      style={[T.body, {
                        color: C.text,
                        backgroundColor: C.bg3,
                        borderRadius: R.md,
                        paddingHorizontal: SP['3'],
                        paddingVertical: SP['3'],
                        minHeight: 80,
                        textAlignVertical: 'top',
                      }]}
                      maxLength={1000}
                    />
                  </View>
                ) : (
                  <View style={{ gap: 4 }}>
                    <Text style={[T.caption, { color: C.text3, letterSpacing: 0.6 }]}>承認時のメモ (任意)</Text>
                    <TextInput
                      value={approveNotes}
                      onChangeText={setApproveNotes}
                      placeholder="必要に応じて運営側のメモを残せます"
                      placeholderTextColor={C.text3}
                      style={[T.body, {
                        color: C.text,
                        backgroundColor: C.bg3,
                        borderRadius: R.md,
                        paddingHorizontal: SP['3'],
                        paddingVertical: SP['3'],
                      }]}
                      maxLength={500}
                    />
                  </View>
                )}
              </ScrollView>
            )}

            {/* アクション */}
            {openApp && !rejectMode && (
              <View style={{ flexDirection: 'row', gap: SP['2'] }}>
                <PressableScale
                  onPress={() => setRejectMode(true)}
                  haptic="warn"
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    paddingVertical: SP['3'],
                    backgroundColor: C.redBg,
                    borderRadius: R.lg,
                    borderWidth: 1,
                    borderColor: C.red + '66',
                  }}
                >
                  <Icon.close size={16} color={C.red} strokeWidth={2.4} />
                  <Text style={[T.bodyB, { color: C.red, fontWeight: '700' }]}>却下</Text>
                </PressableScale>
                <PressableScale
                  onPress={() => approve.mutate(openApp)}
                  haptic="confirm"
                  disabled={approve.isPending}
                  style={{
                    flex: 1.4,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    paddingVertical: SP['3'],
                    backgroundColor: C.green,
                    borderRadius: R.lg,
                    opacity: approve.isPending ? 0.6 : 1,
                  }}
                >
                  {approve.isPending && <ActivityIndicator size="small" color="#fff" />}
                  <Icon.check size={16} color="#fff" strokeWidth={2.6} />
                  <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>承認する</Text>
                </PressableScale>
              </View>
            )}

            {openApp && rejectMode && (
              <View style={{ flexDirection: 'row', gap: SP['2'] }}>
                <PressableScale
                  onPress={() => { setRejectMode(false); setRejectReason(''); }}
                  haptic="tap"
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: SP['3'],
                    backgroundColor: C.bg3,
                    borderRadius: R.lg,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Text style={[T.bodyB, { color: C.text2, fontWeight: '700' }]}>戻る</Text>
                </PressableScale>
                <PressableScale
                  onPress={() => reject.mutate(openApp)}
                  haptic="warn"
                  disabled={!canReject}
                  style={{
                    flex: 1.4,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    paddingVertical: SP['3'],
                    backgroundColor: C.red,
                    borderRadius: R.lg,
                    opacity: canReject ? 1 : 0.5,
                  }}
                >
                  {reject.isPending && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>却下を確定</Text>
                </PressableScale>
              </View>
            )}
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[T.caption, { color: C.text3, letterSpacing: 0.6 }]}>{label}</Text>
      <Text style={[T.body, { color: C.text }]}>{value}</Text>
    </View>
  );
}

function VerificationBadge({ status }: { status: string | undefined }) {
  const s = status ?? 'unverified';
  let label: string;
  let bg: string;
  let fg: string;
  let border: string;
  if (s === 'verified') {
    label = '✓ URL確認済み';
    bg = C.greenBg;
    fg = C.green;
    border = C.green + '66';
  } else if (s === 'failed') {
    label = '確認失敗';
    bg = C.amberBg;
    fg = C.amber;
    border = C.amber + '66';
  } else {
    // unverified / pending
    label = '未確認';
    bg = C.bg3;
    fg = C.text3;
    border = C.border;
  }
  return (
    <View
      style={{
        paddingHorizontal: SP['2'],
        paddingVertical: 2,
        backgroundColor: bg,
        borderRadius: R.sm,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <Text style={{ color: fg, fontSize: 10, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
