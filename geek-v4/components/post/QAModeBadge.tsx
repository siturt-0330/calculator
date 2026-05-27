import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { R, SP, GRAD, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

// ============================================================
// QAModeBadge — Q&A モード (post-level) を可視化する小型 chip
// ------------------------------------------------------------
// Reddit ガイド #17 (4.6 / 5.4 章) — post の author が Q&A モードを enable
// したときに、post 上部 / タイトル横に「Q&A モード」と表示する。
//
// Geek UI 統一:
//   - 背景: gradient (GRAD.primary)
//   - text: T.smallM, color #fff, fontWeight 700
//   - icon: 左に Icon.help size=12 (lucide HelpCircle)
//   - padding: SP['1'] SP['2']
//   - radius: R.full
//   - shadow: SHADOW.glow (紫 glow — active state)
//
// controlled でも uncontrolled でもなく、純粋表示 component。
// 「現在 Q&A モード ON」を呼出側で判定して条件付きで render する想定。
// ============================================================

export function QAModeBadge({
  label = 'Q&A モード',
}: {
  label?: string;
}) {
  const Help = Icon.help;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        borderRadius: R.full,
        overflow: 'hidden',
        alignSelf: 'flex-start',
        ...SHADOW.glow,
      }}
    >
      <LinearGradient
        colors={GRAD.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['1'],
          paddingHorizontal: SP['2'],
          paddingVertical: SP['1'],
          borderRadius: R.full,
        }}
      >
        <Help size={12} color="#fff" strokeWidth={2.5} />
        <Text
          style={[
            T.smallM,
            {
              color: '#fff',
              fontWeight: '700',
            },
          ]}
        >
          {label}
        </Text>
      </LinearGradient>
    </View>
  );
}

// 呼出側は `import { QAModeBadge } from '../../components/post/QAModeBadge'`。
