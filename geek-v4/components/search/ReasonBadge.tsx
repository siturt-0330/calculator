import { View, Text } from 'react-native';
import { C, SP, R } from '@/design/tokens';

// 検索結果の理由 badge — scoring.ts が返す reason 文字列を意味的に分類して
// 視覚的に分けるための統一コンポーネント。
//
// カテゴリと色のマッピング (UI 上の意味):
//   positive   — 完全一致 / 高信頼              → green
//   relational — 関連# / 連携 / #タグ           → accent purple (default)
//   trend      — 🔥トレンド / 新着              → red / cyan
//   personal   — ❤あなたの推し / 👀よく見る   → pink
//   correction — typo:                          → amber
type Category = 'positive' | 'relational' | 'trend-hot' | 'trend-new' | 'personal' | 'correction' | 'default';

const COLORS: Record<Category, { bg: string; fg: string }> = {
  positive:   { bg: C.greenBg,  fg: C.green },
  relational: { bg: C.accentBg, fg: C.accent },
  'trend-hot':{ bg: C.redBg,    fg: C.red },
  'trend-new':{ bg: 'rgba(124,177,255,0.13)', fg: '#7CB1FF' }, // cyan-ish
  personal:   { bg: C.pinkBg,   fg: C.pink },
  correction: { bg: C.amberBg,  fg: C.amber },
  default:    { bg: C.bg3,      fg: C.text2 },
};

function categorize(reason: string): Category {
  // 完全一致 / 高信頼 → 緑
  if (reason.includes('完全一致') || reason.includes('高信頼')) return 'positive';
  // トレンド 🔥
  if (reason.startsWith('🔥')) return 'trend-hot';
  // 新着 (時刻系)
  if (reason === '新着') return 'trend-new';
  // 個人化 ❤あなたの推し / 👀よく見る
  if (reason.startsWith('❤') || reason.startsWith('👀')) return 'personal';
  // タイポ correction
  if (reason.startsWith('typo:')) return 'correction';
  // タグ系 (#xxx / 関連#xxx / 連携)
  if (reason.startsWith('#') || reason.startsWith('関連') || reason === '連携') return 'relational';
  // 引用 phrase
  if (reason.startsWith('"')) return 'relational';
  // default
  return 'default';
}

export function ReasonBadge({ reason, size = 'sm' }: { reason: string; size?: 'sm' | 'xs' }) {
  const cat = categorize(reason);
  const { bg, fg } = COLORS[cat];
  const fontSize = size === 'xs' ? 9 : 10;
  const px = size === 'xs' ? 4 : 6;
  const py = size === 'xs' ? 1 : 2;
  return (
    <View style={{
      paddingHorizontal: px,
      paddingVertical: py,
      backgroundColor: bg,
      borderRadius: R.sm,
      borderWidth: 1,
      borderColor: fg + '33',
    }}>
      <Text style={{ fontSize, color: fg, fontWeight: '700', lineHeight: fontSize + 2 }}>{reason}</Text>
    </View>
  );
}

// 複数の reason をまとめて表示するコンテナ
// 重要度順に並べ替えて max まで
const REASON_PRIORITY: Category[] = ['positive', 'trend-hot', 'personal', 'correction', 'relational', 'trend-new', 'default'];

export function ReasonBadges({
  reasons,
  max = 3,
  size = 'sm',
}: {
  reasons: readonly string[];
  max?: number;
  size?: 'sm' | 'xs';
}) {
  if (!reasons || reasons.length === 0) return null;
  // カテゴリで sort
  const sorted = [...reasons].sort((a, b) => {
    const ai = REASON_PRIORITY.indexOf(categorize(a));
    const bi = REASON_PRIORITY.indexOf(categorize(b));
    return ai - bi;
  });
  return (
    <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
      {sorted.slice(0, max).map((r) => (
        <ReasonBadge key={r} reason={r} size={size} />
      ))}
      {sorted.length > max && (
        <Text style={{ fontSize: size === 'xs' ? 9 : 10, color: C.text3, alignSelf: 'center' }}>
          +{sorted.length - max}
        </Text>
      )}
    </View>
  );
}
