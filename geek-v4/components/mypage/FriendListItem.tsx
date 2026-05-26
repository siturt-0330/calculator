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
//
// UI Polish (Phase 2):
// - 全体を GlassCard で巻く (rgba 半透明 + 1px white border)
// - Avatar の周りに gradient ring (LinearGradient で 1.5px 円リング)
// - PolishedButton で承認 / 拒否 / キャンセルを統一
// - SHADOW.xs を加えて柔らかい立体感
// ============================================================

import { View, Text, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../ui/PressableScale';
import { Avatar } from '../ui/Avatar';
import { GlassCard } from '../ui/GlassCard';
import { PolishedButton } from '../ui/PolishedButton';
import { Icon } from '../../constants/icons';
import { C, GRAD, R, SHADOW, SP } from '../../design/tokens';
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
const AVATAR_SIZE = 48;
// gradient ring は avatar の周りに 1.5px の輪 — 透けた背景に映える
const RING_THICKNESS = 1.5;

/**
 * Avatar の周りに gradient ring を描く wrapper.
 * LinearGradient で正円を描き、中央に通常の Avatar を重ねる (overflow:'hidden' で円形に clip)。
 */
function GradientRingAvatar({
  uri,
  emoji,
  name,
}: {
  uri?: string | null;
  emoji?: string | null;
  name?: string;
}) {
  const outer = AVATAR_SIZE + RING_THICKNESS * 2;
  return (
    <View
      style={{
        width: outer,
        height: outer,
        borderRadius: outer / 2,
        overflow: 'hidden',
      }}
    >
      <LinearGradient
        colors={GRAD.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: AVATAR_SIZE / 2,
            backgroundColor: C.bg2,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <Avatar
            size={AVATAR_SIZE}
            uri={uri ?? undefined}
            emoji={emoji ?? undefined}
            name={name}
          />
        </View>
      </LinearGradient>
    </View>
  );
}

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

  // mode 別の背景 highlight:
  // - incoming は subtle accent tint (申請者が目を引くように)
  // - outgoing / friend は transparent (GlassCard だけで十分な階層感)
  const highlightBg =
    mode === 'incoming' ? 'rgba(124,106,247,0.05)' : 'transparent';

  const cardInner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
      }}
    >
      <GradientRingAvatar
        uri={profile.avatar_url}
        emoji={profile.avatar_emoji}
        name={nickname}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={[T.bodyMd, { color: C.text, fontWeight: '700' }]}
          numberOfLines={1}
        >
          {nickname}
        </Text>
        {bio ? (
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {bio}
          </Text>
        ) : mode === 'outgoing' ? (
          // 「申請中…」を chip 風に (subtle background)
          <View
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: SP['2'],
              paddingVertical: 2,
              borderRadius: R.full,
              backgroundColor: 'rgba(245,166,35,0.12)',
              marginTop: 2,
            }}
          >
            <Text style={[T.caption, { color: C.amber, fontWeight: '700' }]}>
              申請中…
            </Text>
          </View>
        ) : null}
      </View>
      {/* 右側のアクション群: mode で切替 */}
      {mode === 'incoming' && (
        <View style={{ flexDirection: 'row', gap: SP['2'] }}>
          <PolishedButton
            variant="gradient"
            gradient="success"
            size="sm"
            label="承認"
            icon={<Icon.ok size={14} color="#fff" strokeWidth={2.4} />}
            onPress={() => onAccept?.()}
            disabled={busy || !onAccept}
            loading={busy}
            haptic="confirm"
          />
          <PolishedButton
            variant="outline"
            size="sm"
            label="拒否"
            icon={<Icon.close size={14} color={C.accent} strokeWidth={2.4} />}
            onPress={() => onDecline?.()}
            disabled={busy || !onDecline}
            haptic="tap"
          />
        </View>
      )}
      {mode === 'outgoing' && (
        <PolishedButton
          variant="outline"
          size="sm"
          label={busy ? '…' : 'キャンセル'}
          onPress={() => onCancel?.()}
          disabled={busy || !onCancel}
          loading={busy}
          haptic="tap"
        />
      )}
      {mode === 'friend' && busy && <ActivityIndicator color={C.accent} />}
    </View>
  );

  // GlassCard + SHADOW.xs で柔らかい立体感. 内側に highlight bg を重ねる.
  const card = (
    <GlassCard style={{ padding: SP['3'], ...SHADOW.xs }}>
      <View
        style={{
          backgroundColor: highlightBg,
          borderRadius: R.md,
          padding: SP['1'],
        }}
      >
        {cardInner}
      </View>
    </GlassCard>
  );

  if (mode === 'friend' && onPress) {
    return (
      <PressableScale onPress={onPress} haptic="tap" disabled={busy}>
        {card}
      </PressableScale>
    );
  }
  return card;
}
