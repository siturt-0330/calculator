// ============================================================
// components/community/MemberRow.tsx
// ------------------------------------------------------------
// 管理人画面 (community/[id]/admin.tsx) のメンバー一覧用 row。
// avatar + nickname + role badge + (kick / ban / promote action).
//
// 権限ルール (UI 表示判定):
//   - owner: 全員に対し kick / promote / ban 可能 (自分自身除く)
//   - admin: member に対し kick / ban 可能。owner/admin には何もできない
//   - 自分自身の行: 操作ボタンは出さない
// ============================================================
import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import type { MemberRole } from '../../lib/api/communities';

export type MemberRowItem = {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  role: MemberRole;
  joined_at: string;
  /** trust_score 等の補助情報を表示する用 (optional) */
  trust_score?: number | null;
};

const ROLE_META: Record<
  MemberRole,
  { label: string; color: string; bg: string; border: string }
> = {
  owner: {
    label: 'オーナー',
    color: '#F5C842',
    bg: 'rgba(245,200,66,0.16)',
    border: 'rgba(245,200,66,0.55)',
  },
  admin: {
    label: '管理者',
    color: C.accent,
    bg: C.accentBg,
    border: C.accent + '55',
  },
  member: {
    label: 'メンバー',
    color: C.text3,
    bg: C.bg3,
    border: C.border,
  },
};

export function MemberRow({
  member,
  currentRole,
  isSelf,
  onKick,
  onBan,
  onPromote,
}: {
  member: MemberRowItem;
  /** 操作する側 (current user) の role。null は読み取り専用扱い */
  currentRole: MemberRole | null;
  /** member.user_id === current user のとき true (自分の行) */
  isSelf: boolean;
  onKick?: (m: MemberRowItem) => void;
  onBan?: (m: MemberRowItem) => void;
  onPromote?: (m: MemberRowItem) => void;
}) {
  const meta = ROLE_META[member.role];

  // 権限判定:
  //   owner は全員に対して操作可 (admin 含む)
  //   admin は member に対してのみ操作可
  //   それ以外 (null / member) は操作不可
  let canKick = false;
  let canBan = false;
  let canPromote = false;
  if (!isSelf && currentRole === 'owner') {
    // owner は admin/member 両方 kick/ban 可、promote は member → admin 限定
    canKick = member.role !== 'owner';
    canBan = member.role !== 'owner';
    canPromote = member.role === 'member';
  } else if (!isSelf && currentRole === 'admin') {
    // admin は member のみ操作可
    canKick = member.role === 'member';
    canBan = member.role === 'member';
    // promote は owner 限定 (admin は admin を作れない)
    canPromote = false;
  }

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          paddingHorizontal: SP['3'],
          paddingVertical: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
        },
        SHADOW.xs,
      ]}
    >
      <Avatar
        size={40}
        uri={member.avatar_url}
        name={member.nickname}
        color={C.bg3}
      />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[T.bodyM, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
            {member.nickname || '匿名'}
          </Text>
          {isSelf && (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                backgroundColor: C.bg3,
                borderRadius: R.sm,
              }}
            >
              <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700' }}>あなた</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: meta.bg,
              borderRadius: R.sm,
              borderWidth: 1,
              borderColor: meta.border,
            }}
          >
            <Text style={{ color: meta.color, fontSize: 10, fontWeight: '700' }}>
              {meta.label}
            </Text>
          </View>
          {typeof member.trust_score === 'number' && (
            <Text style={[T.caption, { color: C.text3 }]}>
              信用 {member.trust_score}
            </Text>
          )}
        </View>
      </View>
      {/* 操作ボタン群 — currentRole + 対象 role の組み合わせで出し分け */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {canPromote && onPromote && (
          <PressableScale
            onPress={() => onPromote(member)}
            haptic="tap"
            accessibilityLabel={`${member.nickname} を管理者に昇格`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: SP['2'],
              paddingVertical: 6,
              backgroundColor: C.accentBg,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.accent + '55',
            }}
          >
            <Icon.award size={11} color={C.accent} strokeWidth={2.4} />
            <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>昇格</Text>
          </PressableScale>
        )}
        {canKick && onKick && (
          <PressableScale
            onPress={() => onKick(member)}
            haptic="warn"
            accessibilityLabel={`${member.nickname} をキック`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: SP['2'],
              paddingVertical: 6,
              backgroundColor: C.bg3,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.border2,
            }}
          >
            <Icon.logout size={11} color={C.text2} strokeWidth={2.4} />
            <Text style={{ color: C.text2, fontSize: 10, fontWeight: '700' }}>キック</Text>
          </PressableScale>
        )}
        {canBan && onBan && (
          <PressableScale
            onPress={() => onBan(member)}
            haptic="warn"
            accessibilityLabel={`${member.nickname} を BAN`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: SP['2'],
              paddingVertical: 6,
              backgroundColor: C.redBg,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.red + '55',
            }}
          >
            <Icon.block size={11} color={C.red} strokeWidth={2.4} />
            <Text style={{ color: C.red, fontSize: 10, fontWeight: '700' }}>BAN</Text>
          </PressableScale>
        )}
      </View>
    </View>
  );
}
