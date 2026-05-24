// ============================================================
// SubscribeButton — コミュニティ参加/解除 CTA ボタン
// ============================================================
// app/(tabs)/community/[id]/index.tsx から抽出。
// isMember=true: 「参加中」(outline + chevron)
// isMember=false: 「参加する」or「参加を申請する」(accent fill + glow)
// loading 中は activity indicator + 文言切替 + disabled
// ============================================================
import { ActivityIndicator, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

export function SubscribeButton({
  isMember,
  isRequestVisibility,
  loading,
  onPress,
}: {
  isMember: boolean;
  isRequestVisibility: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  if (isMember) {
    return (
      <PressableScale
        onPress={onPress}
        haptic="tap"
        disabled={loading}
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SP['2'],
          backgroundColor: 'transparent',
          borderRadius: R.full,
          borderWidth: 1.5,
          borderColor: C.border2,
          paddingVertical: SP['3'],
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={C.text2} />
        ) : (
          <Icon.bell size={15} color={C.text2} strokeWidth={2.2} />
        )}
        <Text style={[T.bodyB, { color: C.text2, fontWeight: '700' }]}>
          {loading ? '処理中…' : '参加中'}
        </Text>
        {!loading && <Icon.chevronD size={13} color={C.text3} strokeWidth={2.2} />}
      </PressableScale>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      haptic="confirm"
      disabled={loading}
      style={{
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SP['2'],
        backgroundColor: C.accent,
        borderRadius: R.full,
        paddingVertical: SP['3'],
        opacity: loading ? 0.7 : 1,
        ...SHADOW.accentGlow,
      }}
    >
      {loading && <ActivityIndicator size="small" color="#fff" />}
      <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>
        {loading ? '処理中…' : isRequestVisibility ? '参加を申請する' : 'コミュニティに参加する'}
      </Text>
    </PressableScale>
  );
}
