import { LinearGradient } from 'expo-linear-gradient';
import { View, type ViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { GRAD, SHADOW, R, SP } from '../../design/tokens';

// LinearGradient の `colors` prop は readonly [string, string, ...string[]] を要求。
// GRAD の各 entry はすでに `as const` で固定された tuple なので、その shape を
// 受け取れるキー集合に絞ってから引く。
type GradientKey = keyof typeof GRAD;

export interface GradientCardProps extends ViewProps {
  /** GRAD のどのグラデを使うか (default: 'primary') */
  gradient?: GradientKey;
  /** SHADOW.glow を付けて発光させるか (default: false) */
  glow?: boolean;
  /** LinearGradient の start 座標 — 省略時は左上→右下のやや斜め */
  start?: { x: number; y: number };
  /** LinearGradient の end 座標 — 省略時は右下 */
  end?: { x: number; y: number };
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * 紫→桃のグラデ背景を持つカード。
 *
 * - 既定 padding: SP['4']
 * - 既定 borderRadius: R.lg
 * - glow=true で SHADOW.glow (紫の色付き shadow) を加算
 * - LinearGradient のクリッピングのため overflow:'hidden' を強制
 */
export function GradientCard({
  gradient = 'primary',
  glow = false,
  start,
  end,
  style,
  children,
  ...rest
}: GradientCardProps) {
  const colors = GRAD[gradient];
  const startPt = start ?? { x: 0, y: 0 };
  const endPt = end ?? { x: 1, y: 1 };

  return (
    <View
      style={[
        {
          borderRadius: R.lg,
          overflow: 'hidden',
        },
        glow ? SHADOW.glow : null,
        style,
      ]}
      {...rest}
    >
      <LinearGradient
        // GRAD は `[string, string, ...string[]]` を満たす readonly tuple なので
        // expo-linear-gradient の colors prop にそのまま渡せる。
        colors={colors}
        start={startPt}
        end={endPt}
        style={{
          flex: 1,
          padding: SP['4'],
          borderRadius: R.lg,
        }}
      >
        {children}
      </LinearGradient>
    </View>
  );
}
