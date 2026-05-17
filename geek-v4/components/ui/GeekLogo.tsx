import { View } from 'react-native';
import Svg, { Circle, Path, G } from 'react-native-svg';

// Geek 公式ロゴ: 黒丸 + アンカー (錨) が組み込まれた G
export function GeekLogo({ size = 120, bg = '#000', fg = '#fff' }: {
  size?: number;
  bg?: string;
  fg?: string;
}) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        {/* 外側の黒丸 */}
        <Circle cx="100" cy="100" r="92" fill={bg} />
        <G>
          {/* G の本体 (C 字形) — 太い線 */}
          <Path
            d="M 142 75
               C 132 55, 105 50, 85 60
               C 65 70, 55 95, 65 120
               C 75 145, 105 152, 130 142
               L 130 105
               L 105 105"
            stroke={fg}
            strokeWidth="18"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* アンカー: G の右下から下に伸びる縦棒 */}
          <Path
            d="M 130 105 L 130 165"
            stroke={fg}
            strokeWidth="10"
            strokeLinecap="round"
          />
          {/* アンカー: 横棒 (クロスバー) */}
          <Path
            d="M 116 122 L 144 122"
            stroke={fg}
            strokeWidth="8"
            strokeLinecap="round"
          />
          {/* アンカー: 下の湾曲フック */}
          <Path
            d="M 108 152
               C 108 165, 118 172, 130 172
               C 142 172, 152 165, 152 152"
            stroke={fg}
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
          />
          {/* フックの矢先 (両端) */}
          <Path
            d="M 102 148 L 108 152 L 108 144 Z"
            fill={fg}
          />
          <Path
            d="M 158 148 L 152 152 L 152 144 Z"
            fill={fg}
          />
        </G>
      </Svg>
    </View>
  );
}
