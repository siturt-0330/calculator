// ============================================================
// app/(tabs)/community/[id]/admin.tsx
// ------------------------------------------------------------
// コミュニティ管理人画面 (owner / admin のみアクセス可)。
//
// 構成 3 セクション:
//   1. メンバー一覧 (SegmentedControl で 全員 / mod のみ)
//   2. BAN リスト
//   3. モデログ (直近 50 件)
//
// 一般 member は redirect (== community 詳細に戻す)。
//
// 全ての destructive 操作は ConfirmDialog 必須。
// mutation は hooks/useCommunityMods.ts (= 既に実装済) を経由。
// ============================================================
import { View, Text, ScrollView } from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { C, R, SP } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { TABBAR } from '../../../../design/tabbar';
import { BackButton } from '../../../../components/nav/BackButton';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { Spinner } from '../../../../components/ui/Spinner';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { Divider } from '../../../../components/ui/Divider';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { Icon } from '../../../../constants/icons';
import { CommunitySubTabs } from '../../../../components/community/CommunitySubTabs';
import { MemberRow, type MemberRowItem } from '../../../../components/community/MemberRow';
import { useAuthStore } from '../../../../stores/authStore';
import { fetchCommunity, type MemberRole } from '../../../../lib/api/communities';
import {
  useCommunityMembers,
  useCommunityBans,
  useModActionLogs,
  useKickMember,
  useBanMember,
  useUnbanMember,
  usePromoteMember,
  useDemoteMember,
} from '../../../../hooks/useCommunityMods';
import {
  useCommunityJoinRequests,
  useApproveJoinRequest,
  useRejectJoinRequest,
} from '../../../../hooks/useCommunityJoinRequests';
import { Avatar } from '../../../../components/ui/Avatar';
import type {
  MemberWithProfile,
  BanWithProfile,
  ModActionLog,
} from '../../../../lib/api/communityMods';
import { formatRelative } from '../../../../lib/utils/date';

type MembersFilter = 'all' | 'mods';
type PendingAction =
  | { kind: 'kick'; member: MemberRowItem }
  | { kind: 'ban'; member: MemberRowItem }
  | { kind: 'unban'; ban: BanWithProfile }
  | { kind: 'promote'; member: MemberRowItem }
  | { kind: 'demote'; member: MemberRowItem }
  | null;

export default function CommunityAdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const userId = useAuthStore((s) => s.user?.id);

  const { data: community, isLoading: communityLoading } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });

  // mod 権限判定 (owner or admin)
  const isMod = !!community && (community.role === 'owner' || community.role === 'admin');

  // member であれば redirect (権限なし通知 → 詳細に戻す)
  useEffect(() => {
    if (communityLoading || !community) return;
    if (!isMod) {
      // 「権限なし」をユーザーに伝えてから replace 戻す (toast は store 経由がない場合に備えて router.replace で安全に)
      router.replace(`/community/${id}` as never);
    }
  }, [communityLoading, community, isMod, router, id]);

  // hooks (id が無いと no-op)
  const { members, isLoading: membersLoading } = useCommunityMembers(isMod ? id : undefined);
  const { bans, isLoading: bansLoading } = useCommunityBans(isMod ? id : undefined);
  const { logs, isLoading: logsLoading } = useModActionLogs(isMod ? id : undefined, 50);

  const kick = useKickMember(id);
  const ban = useBanMember(id);
  const unban = useUnbanMember(id);
  const promote = usePromoteMember(id);
  const demote = useDemoteMember(id);

  // 参加申請 (owner / admin) — visibility が open のときは UI を隠す
  const showJoinRequests = isMod && !!community && community.visibility !== 'open';
  const { requests: joinRequests, isLoading: requestsLoading } = useCommunityJoinRequests(
    showJoinRequests ? id : undefined,
  );
  const approveReq = useApproveJoinRequest(id);
  const rejectReq = useRejectJoinRequest(id);

  const [filter, setFilter] = useState<MembersFilter>('all');
  const [pending, setPending] = useState<PendingAction>(null);

  // フィルタ後のメンバー一覧
  const filteredMembers = useMemo(() => {
    if (filter === 'mods') {
      return members.filter((m) => m.role === 'owner' || m.role === 'admin');
    }
    return members;
  }, [members, filter]);

  const goSubTab = useCallback(
    (key: 'home' | 'bbs' | 'map' | 'calendar' | 'admin') => {
      if (key === 'admin') return;
      const dest =
        key === 'home' ? `/community/${id}`
        : key === 'bbs' ? `/community/${id}/bbs`
        : key === 'map' ? `/community/${id}/map`
        : `/community/${id}/calendar`;
      router.push(dest as never);
    },
    [router, id],
  );

  // member rendering helper — MemberWithProfile → MemberRowItem
  const toMemberRowItem = useCallback((m: MemberWithProfile): MemberRowItem => ({
    user_id: m.user_id,
    nickname: m.profile?.nickname ?? '匿名',
    avatar_url: m.profile?.avatar_url ?? null,
    role: m.role,
    joined_at: m.joined_at,
  }), []);

  const currentRole: MemberRole | null = community?.role ?? null;

  // ローディング中 (community fetch 自体) または mod でないとき (redirect 待ち) は spinner
  if (communityLoading || !community) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Spinner size="large" />
      </View>
    );
  }
  if (!isMod) {
    // redirect は useEffect で実行中 — 一瞬出る placeholder
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: SP['6'], gap: SP['3'], justifyContent: 'center', alignItems: 'center' }}>
        <Icon.shield size={48} color={C.text3} strokeWidth={1.8} />
        <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>権限がありません</Text>
        <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
          この画面はコミュニティの管理人 (オーナー / 管理者) のみ閲覧できます。
        </Text>
      </View>
    );
  }

  // Confirm dialog の title/message を action から導出
  const dialogTitle =
    pending?.kind === 'kick' ? 'メンバーをキック'
    : pending?.kind === 'ban' ? 'メンバーを BAN'
    : pending?.kind === 'unban' ? 'BAN を解除'
    : pending?.kind === 'promote' ? '管理人に昇格'
    : pending?.kind === 'demote' ? 'member に降格'
    : '';
  const dialogMessage = (() => {
    if (!pending) return '';
    if (pending.kind === 'kick') {
      return `「${pending.member.nickname}」をこのコミュニティから外します。再加入は本人の任意で可能です。`;
    }
    if (pending.kind === 'ban') {
      return `「${pending.member.nickname}」を BAN します。再加入できなくなります。`;
    }
    if (pending.kind === 'unban') {
      return `「${pending.ban.profile?.nickname ?? '匿名'}」の BAN を解除します。`;
    }
    if (pending.kind === 'promote') {
      return `「${pending.member.nickname}」さんを管理人に昇格しますか?\n\n投稿削除 / キック / BAN の権限を持ちます。`;
    }
    // demote
    return `「${pending.member.nickname}」さんを member に降格しますか?\n\n管理権限はすべて失われます。`;
  })();

  // Confirm 後の処理ボタンラベル
  const confirmLabel =
    pending?.kind === 'kick' ? 'キックする'
    : pending?.kind === 'ban' ? 'BAN する'
    : pending?.kind === 'unban' ? '解除する'
    : pending?.kind === 'promote' ? '昇格する'
    : pending?.kind === 'demote' ? '降格する'
    : '確認';

  // destructive 表示 (赤系) は kick / ban / demote。
  // promote / unban は positive (accent) として扱う。
  const isDestructive =
    pending?.kind === 'kick' ||
    pending?.kind === 'ban' ||
    pending?.kind === 'demote';

  const onConfirm = () => {
    if (!pending) return;
    if (pending.kind === 'kick') {
      kick.mutate({ communityId: id, userId: pending.member.user_id });
    } else if (pending.kind === 'ban') {
      ban.mutate({ communityId: id, userId: pending.member.user_id });
    } else if (pending.kind === 'unban') {
      unban.mutate({ communityId: id, userId: pending.ban.user_id });
    } else if (pending.kind === 'promote') {
      promote.mutate({ communityId: id, userId: pending.member.user_id });
    } else {
      demote.mutate({ communityId: id, userId: pending.member.user_id });
    }
    setPending(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* TopBar */}
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
          <Icon.shield size={18} color={C.amber} strokeWidth={2.4} />
          <Text style={[T.h3, { color: C.text }]} numberOfLines={1}>
            管理人
          </Text>
          {community.name && (
            <Text style={[T.small, { color: C.text3 }]} numberOfLines={1}>
              · {community.name}
            </Text>
          )}
        </View>
      </View>

      {/* Sub tabs nav — current=admin */}
      <CommunitySubTabs value="admin" onChange={goSubTab} showAdmin={true} />

      <ScrollView
        contentContainerStyle={{
          paddingTop: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['16'],
          gap: SP['5'],
        }}
      >
        {/* ============= Section 0: 参加申請 (request 制のみ) ============= */}
        {showJoinRequests && (
          <>
            <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon.bell size={18} color={C.accent} strokeWidth={2.4} />
                  <Text style={[T.h3, { color: C.text }]}>参加申請</Text>
                </View>
                {joinRequests.length > 0 ? (
                  <View
                    style={{
                      backgroundColor: C.accent,
                      paddingHorizontal: SP['2'],
                      paddingVertical: 2,
                      borderRadius: R.full,
                      minWidth: 24,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>
                      {joinRequests.length}
                    </Text>
                  </View>
                ) : (
                  <Text style={[T.caption, { color: C.text3 }]}>0 件</Text>
                )}
              </View>
              {requestsLoading ? (
                <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}>
                  <Spinner size="large" />
                </View>
              ) : joinRequests.length === 0 ? (
                <View style={{ paddingVertical: SP['6'], alignItems: 'center', gap: SP['2'] }}>
                  <Icon.bell size={28} color={C.text3} strokeWidth={1.6} />
                  <Text style={[T.small, { color: C.text3 }]}>保留中の申請はありません</Text>
                </View>
              ) : (
                <View style={{ gap: SP['2'] }}>
                  {joinRequests.map((req) => {
                    const submitting = approveReq.isPending || rejectReq.isPending;
                    return (
                      <View
                        key={req.user_id}
                        style={{
                          padding: SP['3'],
                          backgroundColor: C.bg2,
                          borderRadius: R.md,
                          borderWidth: 1,
                          borderColor: C.border,
                          gap: SP['3'],
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                          <Avatar
                            size={36}
                            uri={req.avatar_url ?? undefined}
                            emoji={req.avatar_emoji ?? undefined}
                            name={req.nickname}
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[T.smallB, { color: C.text }]} numberOfLines={1}>
                              {req.nickname}
                            </Text>
                            <Text style={[T.caption, { color: C.text3 }]}>
                              {formatRelative(req.created_at)}
                            </Text>
                          </View>
                        </View>
                        {req.message ? (
                          <Text style={[T.small, { color: C.text2 }]} numberOfLines={3}>
                            {req.message}
                          </Text>
                        ) : null}
                        <View style={{ flexDirection: 'row', gap: SP['2'] }}>
                          <PressableScale
                            onPress={() => rejectReq.mutate(req.user_id)}
                            haptic="tap"
                            disabled={submitting}
                            accessibilityLabel={`${req.nickname} の申請を拒否`}
                            style={{
                              flex: 1,
                              paddingVertical: SP['2'],
                              borderRadius: R.md,
                              borderWidth: 1,
                              borderColor: C.border2,
                              alignItems: 'center',
                              opacity: submitting ? 0.5 : 1,
                            }}
                          >
                            <Text style={[T.smallB, { color: C.text2 }]}>拒否</Text>
                          </PressableScale>
                          <PressableScale
                            onPress={() => approveReq.mutate(req.user_id)}
                            haptic="confirm"
                            disabled={submitting}
                            accessibilityLabel={`${req.nickname} の申請を承認`}
                            style={{
                              flex: 2,
                              paddingVertical: SP['2'],
                              borderRadius: R.md,
                              backgroundColor: C.accent,
                              alignItems: 'center',
                              opacity: submitting ? 0.5 : 1,
                            }}
                          >
                            <Text style={[T.smallB, { color: '#fff' }]}>承認</Text>
                          </PressableScale>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
            <Divider />
          </>
        )}

        {/* ============= Section 1: メンバー一覧 ============= */}
        <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[T.h3, { color: C.text }]}>メンバー一覧</Text>
            <Text style={[T.caption, { color: C.text3 }]}>{members.length} 名</Text>
          </View>
          <SegmentedControl<MembersFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '全員' },
              { value: 'mods', label: '管理人のみ' },
            ]}
          />
          {membersLoading ? (
            <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}>
              <Spinner size="large" />
            </View>
          ) : filteredMembers.length === 0 ? (
            <View
              style={{
                paddingVertical: SP['6'],
                alignItems: 'center',
                gap: SP['2'],
              }}
            >
              <Icon.community size={32} color={C.text3} strokeWidth={1.6} />
              <Text style={[T.small, { color: C.text3 }]}>該当するメンバーがいません</Text>
            </View>
          ) : (
            <View style={{ gap: SP['2'] }}>
              {filteredMembers.map((m) => {
                const item = toMemberRowItem(m);
                return (
                  <MemberRow
                    key={m.user_id}
                    member={item}
                    currentRole={currentRole}
                    isSelf={m.user_id === userId}
                    onKick={(target) => setPending({ kind: 'kick', member: target })}
                    onBan={(target) => setPending({ kind: 'ban', member: target })}
                    onPromote={(target) => setPending({ kind: 'promote', member: target })}
                    onDemote={(target) => setPending({ kind: 'demote', member: target })}
                  />
                );
              })}
            </View>
          )}
        </View>

        <Divider />

        {/* ============= Section 2: BAN リスト ============= */}
        <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[T.h3, { color: C.text }]}>BAN リスト</Text>
            <Text style={[T.caption, { color: C.text3 }]}>{bans.length} 件</Text>
          </View>
          {bansLoading ? (
            <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}>
              <Spinner size="large" />
            </View>
          ) : bans.length === 0 ? (
            <View style={{ paddingVertical: SP['6'], alignItems: 'center', gap: SP['2'] }}>
              <Icon.block size={32} color={C.text3} strokeWidth={1.6} />
              <Text style={[T.small, { color: C.text3 }]}>BAN されたメンバーはいません</Text>
            </View>
          ) : (
            <View style={{ gap: SP['2'] }}>
              {bans.map((b) => (
                <BanRow
                  key={b.user_id}
                  ban={b}
                  onUnban={() => setPending({ kind: 'unban', ban: b })}
                />
              ))}
            </View>
          )}
        </View>

        <Divider />

        {/* ============= Section 3: モデログ ============= */}
        <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[T.h3, { color: C.text }]}>モデログ</Text>
            <Text style={[T.caption, { color: C.text3 }]}>直近 {logs.length} 件</Text>
          </View>
          {logsLoading ? (
            <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}>
              <Spinner size="large" />
            </View>
          ) : logs.length === 0 ? (
            <View style={{ paddingVertical: SP['6'], alignItems: 'center', gap: SP['2'] }}>
              <Icon.info size={32} color={C.text3} strokeWidth={1.6} />
              <Text style={[T.small, { color: C.text3 }]}>まだ操作履歴がありません</Text>
            </View>
          ) : (
            <View style={{ gap: SP['2'] }}>
              {logs.map((l) => (
                <ModLogRow key={l.id} log={l} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* destructive confirm */}
      <ConfirmDialog
        visible={pending !== null}
        title={dialogTitle}
        message={dialogMessage}
        confirmLabel={confirmLabel}
        destructive={isDestructive}
        onConfirm={onConfirm}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

// ============================================================
// 内部 row component
// ============================================================

function BanRow({
  ban,
  onUnban,
}: {
  ban: BanWithProfile;
  onUnban: () => void;
}) {
  const nickname = ban.profile?.nickname ?? '匿名';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.red + '33',
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: C.redBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.red + '55',
        }}
      >
        <Icon.block size={18} color={C.red} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.bodyM, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
          {nickname}
        </Text>
        <Text style={[T.caption, { color: C.text3 }]}>
          {formatRelative(ban.banned_at)}
        </Text>
        {ban.reason && ban.reason.length > 0 && (
          <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
            理由: {ban.reason}
          </Text>
        )}
      </View>
      <PressableScale
        onPress={onUnban}
        haptic="tap"
        accessibilityLabel={`${nickname} の BAN を解除`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: SP['3'],
          paddingVertical: 6,
          backgroundColor: C.accentBg,
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: C.accent + '55',
        }}
      >
        <Icon.check size={11} color={C.accent} strokeWidth={2.4} />
        <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>解除</Text>
      </PressableScale>
    </View>
  );
}

// モデログ 1 行: 「[mod] が [action] を [target]. 理由: [reason]」
function ModLogRow({ log }: { log: ModActionLog }) {
  const actionMeta = ACTION_META[log.action];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: SP['3'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: actionMeta.bg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: actionMeta.border,
        }}
      >
        <Icon.shield size={14} color={actionMeta.color} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
            {actionMeta.label}
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            mod: {short(log.mod_user_id)}
          </Text>
          {log.target_user_id && (
            <Text style={[T.caption, { color: C.text3 }]}>
              → user: {short(log.target_user_id)}
            </Text>
          )}
          {log.target_post_id && (
            <Text style={[T.caption, { color: C.text3 }]}>
              → post: {short(log.target_post_id)}
            </Text>
          )}
        </View>
        {log.reason && log.reason.length > 0 && (
          <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
            理由: {log.reason}
          </Text>
        )}
        <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(log.created_at)}</Text>
      </View>
    </View>
  );
}

// UUID を短縮表示 (mod 画面なので user 識別目的)
function short(uuid: string | null | undefined): string {
  if (!uuid) return '?';
  return uuid.slice(0, 8);
}

const ACTION_META: Record<
  ModActionLog['action'],
  { label: string; color: string; bg: string; border: string }
> = {
  delete_post:      { label: '投稿削除',     color: C.red,    bg: C.redBg,    border: C.red + '55' },
  delete_comment:   { label: 'コメント削除', color: C.red,    bg: C.redBg,    border: C.red + '55' },
  delete_bbs_reply: { label: '返信削除',     color: C.red,    bg: C.redBg,    border: C.red + '55' },
  kick:             { label: 'キック',       color: C.amber,  bg: C.amberBg,  border: C.amber + '55' },
  ban:              { label: 'BAN',          color: C.red,    bg: C.redBg,    border: C.red + '55' },
  unban:            { label: 'BAN 解除',     color: C.accent, bg: C.accentBg, border: C.accent + '55' },
  promote:          { label: '昇格',         color: C.accent, bg: C.accentBg, border: C.accent + '55' },
  demote:           { label: '降格',         color: C.text3,  bg: C.bg3,      border: C.border },
};
