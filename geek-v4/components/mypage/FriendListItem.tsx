// ============================================================
// components/mypage/FriendListItem.tsx
// ============================================================
// 友達一覧 / pending リクエストで使う行 component。
// mode で 1 component を使い回す:
//   - friend   : 通常の友達。タップで profile 画面 (Phase 2 では disabled に近い toast)
//   - incoming : 自分宛て pending。承認 / 拒否 button 2 つ
//   - outgoing : 自分発 pending。「申請中…」表記 + キャンセル button
//
// avatar の優先順位: avatar_url > avatar_emoji > nickname の頭文字 (Avatar component に委譲)。
// nickname が null の場合は「匿名さん」を表示 (DB の安全な fallback)。
// ============================================================

import { View, Text, ActivityIndicator } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { Avatar } from '../ui/Avatar';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import type { FriendshipWithProfile } from '../../lib/api/friends';

export type FriendListItemMode = 'friend' | 'incoming' | 'outgoing';

type Props = {
  friendship: FriendshipWithProfile;
  mode: FriendListItemMode;
  // mode='friend' のとき (Phase 2 で profile 画面を実装する想定)
  onPress?: () => void;
  // mode='incoming' のとき
  onAccept?: () => void;
  onDecline?: () => void;
  // mode='outgoing' のとき
  onCancel?: () => void;
  // 共通 — mutation 進行中
  busy?: boolean;
};

const NICKNAME_FALLBACK = '匿名さん';

export function FriendListItem({
  friendship,
  mode,
  onPress,
  onAccept,
  onDecline,
  onCancel,
  busy = false,
}: Props) {
  const profile = friendship.friend_profile;
  const nickname = profile.nickname?.trim() || NICKNAME_FALLBACK;
  const bio = profile.bio?.trim();

  // mode='friend' なら全体を tappable、それ以外は単に View
  const cardContent = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Avatar
        size={44}
        uri={profile.avatar_url ?? undefined}
        emoji={profile.avatar_emoji ?? undefined}
        name={nickname}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
          {nickname}
        </Text>
        {bio ? (
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {bio}
          </Text>
        ) : (
          mode === 'outgoing' && (
            <Text style={[T.caption, { color: C.amber }]}>申請中…</Text>
          )
        )}
      </View>
      {/* 右側のアクション群: mode で切替 */}
      {mode === 'incoming' && (
        <View style={{ flexDirection: 'row', gap: SP['2'] }}>
          <ActionButton
            label={busy ? '…' : '承認'}
            onPress={onAccept}
            tone="accent"
            disabled={busy}
          />
          <ActionButton
            label="拒否"
            onPress={onDecline}
            tone="ghost"
            disabled={busy}
          />
        </View>
      )}
      {mode === 'outgoing' && (
        <ActionButton
          label={busy ? '…' : 'キャンセル'}
          onPress={onCancel}
          tone="ghost"
          disabled={busy}
        />
      )}
      {mode === 'friend' && busy && <ActivityIndicator color={C.accent} />}
    </View>
  );

  if (mode === 'friend' && onPress) {
    return (
      <PressableScale onPress={onPress} haptic="tap" disabled={busy}>
        {cardContent}
      </PressableScale>
    );
  }
  return cardContent;
}

// ============================================================
// 小さい button (FriendListItem の右側専用)
// ============================================================
function ActionButton({
  label,
  onPress,
  tone,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  tone: 'accent' | 'ghost';
  disabled?: boolean;
}) {
  const isAccent = tone === 'accent';
  return (
    <PressableScale
      onPress={onPress}
      haptic={isAccent ? 'confirm' : 'tap'}
      disabled={disabled || !onPress}
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: SP['2'],
        borderRadius: R.full,
        backgroundColor: isAccent ? C.accent : C.bg3,
        borderWidth: 1,
        borderColor: isAccent ? C.accent : C.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={[
          T.smallM,
          { color: isAccent ? '#fff' : C.text2, fontWeight: '700' },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}
