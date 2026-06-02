// ============================================================
// components/account/AccountStateBanner.tsx
// ------------------------------------------------------------
// アカウント状態 (caution / restricted / warned / suspended) のときだけ、
// フィード上部に警告バーを出す。タップで /settings/account-state (透明性画面) へ。
//
// 方針 (2026-06): suspended でもログインは許可し (authStore.checkAccountState で
// ハードブロックを廃止)、代わりにこのバナーで「停止中・異議申し立て」を常時提示する。
// 'healthy' のときは null を返して何も描画しない。
// ============================================================

import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AlertTriangle, ChevronRight } from 'lucide-react-native';
import { PressableScale } from '../ui/PressableScale';
import { useColors } from '../../hooks/useColors';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useAuthStore } from '../../stores/authStore';
import {
  fetchMyAccountState,
  accountStateLabel,
  accountStateShortDescription,
} from '../../lib/api/accountState';

export function AccountStateBanner() {
  const C = useColors();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);

  const { data } = useQuery({
    queryKey: ['my-account-state', userId],
    queryFn: fetchMyAccountState,
    enabled: !!userId,
    staleTime: 60_000,
  });

  if (!data || data.state === 'healthy') return null;

  const desc = accountStateShortDescription(data.state);
  return (
    <PressableScale
      onPress={() => router.push('/settings/account-state' as never)}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={`アカウント状態: ${accountStateLabel(data.state)}。詳細を確認`}
      style={{
        marginHorizontal: SP['3'],
        marginTop: SP['2'],
        padding: SP['3'],
        borderRadius: R.md,
        backgroundColor: C.amberBg,
        borderWidth: 1,
        borderColor: C.amber + '66',
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
      }}
    >
      <AlertTriangle size={18} color={C.amber} strokeWidth={2.2} />
      <View style={{ flex: 1 }}>
        <Text style={[T.smallM, { color: C.amber, fontWeight: '700' }]}>
          アカウント状態: {accountStateLabel(data.state)}
        </Text>
        {!!desc && (
          <Text style={[T.caption, { color: C.text2 }]} numberOfLines={2}>
            {desc}
          </Text>
        )}
      </View>
      <ChevronRight size={16} color={C.text3} strokeWidth={2.2} />
    </PressableScale>
  );
}
