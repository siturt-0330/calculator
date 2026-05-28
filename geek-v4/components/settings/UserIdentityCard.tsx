import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { PressableScale } from '../ui/PressableScale';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../../constants/icons';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors, useGradients } from '../../hooks/useColors';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';

// ============================================================
// UserIdentityCard
// ------------------------------------------------------------
// 設定画面の最上部に出す「自分は誰か」カード:
//
//   ┌─────────────────────────────────────────────┐
//   │ [Avatar 64]   nickname                       │
//   │               プロフィールを編集 →           │
//   └─────────────────────────────────────────────┘
//
// - background: GRAD.primary 低 opacity overlay + base C.bg2
// - tap → /settings/profile-edit
// - avatar / nickname は profiles テーブルから (mypage と同じ query を共有)
// - 信用ティアの肩書は UI からは非表示 (内部スコアは anti-spam に使用)
// ============================================================

type ProfileRow = {
  nickname: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
};

export function UserIdentityCard() {
  const router = useRouter();
  const C = useColors();
  const GRAD = useGradients();
  const user = useAuthStore((s) => s.user);

  // mypage 画面と同じ query key で cache 共有 — mypage を開いた直後に
  // 設定を開いた場合に instant render.
  const { data: profile } = useQuery<ProfileRow | null>({
    queryKey: ['mypage-stats', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('nickname, avatar_url, avatar_emoji')
        .eq('id', user.id)
        .single();
      return data as ProfileRow | null;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const nickname = profile?.nickname ?? user?.nickname ?? 'ユーザー';
  const ChevronR = Icon.chevronR;

  return (
    <PressableScale
      onPress={() => router.push('/settings/profile-edit' as never)}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={`${nickname} のプロフィールを編集`}
      style={{
        marginHorizontal: SP['4'],
        marginTop: SP['3'],
        borderRadius: R.xl,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.bg2,
      }}
    >
      {/* 紫グラデの薄い overlay — 自己同一性の brand 表現. opacity 低めで圧迫感を避ける */}
      <LinearGradient
        colors={[`${GRAD.primary[0]}26`, `${GRAD.primary[1]}14`, 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: SP['4'],
          gap: SP['4'],
        }}
      >
        <Avatar
          size={64}
          uri={profile?.avatar_url}
          emoji={profile?.avatar_emoji}
          name={nickname}
          ring="accent"
        />

        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[T.h3, { color: C.text }]} numberOfLines={1}>
            {nickname}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['1'],
              marginTop: 2,
            }}
          >
            <Text style={[T.small, { color: C.accentLight }]}>プロフィールを編集</Text>
            <ChevronR size={14} color={C.accentLight} strokeWidth={2.4} />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}
