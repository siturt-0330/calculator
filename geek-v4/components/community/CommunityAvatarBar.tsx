// ============================================================
// CommunityAvatarBar — YouTube 登録チャンネル風 avatar 行
// ============================================================
// コミュニティタブ上部の横スクロール選択 UI。
//
// UX:
//   - tap → 詳細ページ遷移 ではなく、画面内 filter (YouTube の
//     登録チャンネル一覧 → 動画絞り込みと同じ動き)
//   - 先頭に「すべて」item (= selectedId null) を固定で配置
//   - 選択中は gradient ring + accent border、未選択は normal border
//
// 設計:
//   - 状態は親 (community/index.tsx) が握り、選択は callback で通知
//   - 純表示 component。データ取得や router.push は持たない
//   - expo-image (thumbedUrl) を使い 720px 変換 + cache
//
// ============================================================
import { View, Text, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { R, SP } from '../../design/tokens';
import { useTheme } from '../../hooks/useColors';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { OfficialBadge } from './OfficialBadge';
import { CommunityIcon } from '../ui/CommunityIcon';

// ------------------------------------------------------------
// 受け取れる community 形状 — CommunityMetaLite と Community の
// 共通最小フィールドだけを要求。Community.is_official は optional
// なので、Community[] をそのまま渡せるように一段緩める。
// ------------------------------------------------------------
type CommunityForAvatar = {
  id: string;
  name: string;
  icon_emoji: string;
  icon_color: string;
  icon_url: string | null;
  is_official?: boolean;
};

// ------------------------------------------------------------
// 視覚定数
// ------------------------------------------------------------
// iOS native (Stories / Following row) 風の比率:
//   - AVATAR_SIZE 56, INNER 52 (= 2pt ring), gap が見えるよう INNER は 4px 内に
//   - 未選択は 1pt subtle border、選択は 2pt accent ring
//   - shadow は SHADOW.xs で「浮かせ過ぎない」(派手な glow は避ける)
const AVATAR_SIZE = 56;
const INNER_SIZE = 52;        // ring (2pt) 内側 — 細めの "framed" 感
const ITEM_WIDTH = 68;        // chip 1 つ分の幅 — 72 → 68 で隣との距離を縮め "繋がり" 感
const LABEL_MAX_CHARS = 8;
// 選択中 chip の下に出す "tab 指示棒" — 共有 dock line と一体化して "現在地" を示す
const SELECTED_INDICATOR_WIDTH = 24;
const SELECTED_INDICATOR_HEIGHT = 2;

// ------------------------------------------------------------
// props
// ------------------------------------------------------------
type Props = {
  /**
   * 参加コミュ一覧 (myCommunities). 空でも render する (hint 表示の判定用)。
   * CommunityMetaLite / Community どちらでも渡せるよう緩めの型を受ける。
   */
  communities: CommunityForAvatar[];
  /** 現在選択中の community id. null = 「すべて」選択中 */
  selectedId: string | null;
  /** tap で呼ばれる. 「すべて」 tap 時は null が渡る */
  onSelect: (id: string | null) => void;
  /** communities が 0 件の時に「コミュに参加してね」 hint を出すか */
  showJoinHint?: boolean;
  /** コンテスト開催中の community_id 集合。該当アバターにグラデリング+🏆バッジを出す。 */
  contestCommunityIds?: Set<string>;
};

// ============================================================
// CommunityAvatarBar
// ============================================================
export function CommunityAvatarBar({
  communities,
  selectedId,
  onSelect,
  showJoinHint = true,
  contestCommunityIds,
}: Props) {
  const isAllSelected = selectedId === null;
  const { C } = useTheme();

  // ───────── 共有 "dock" コンテナ ─────────
  // 1) 上品な縦 gradient (bg2 → bg) で 1 本の "棚" を表現
  // 2) 下端に hairline divider を 1 本通して全 avatar が同じ shelf に立っている感を出す
  //    (absolute gradient で borderBottomWidth が隠れないよう、divider は absolute で重ねる)
  // 3) ScrollView の contentContainer は gap を 12→10 に詰めて "繋がり" を強化
  return (
    <View style={{ position: 'relative' }}>
      <LinearGradient
        colors={[C.bg2, C.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        }}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: SP['2'],
          gap: 10, // SP['3'] (12) → 10: 隣り合う avatar の距離を詰めて bar 全体を一体化
          alignItems: 'flex-start',
        }}
      >
        {/* ───────── 「すべて」(先頭固定) ───────── */}
        <AvatarItem
          label="すべて"
          isSelected={isAllSelected}
          onPress={() => onSelect(null)}
          isAllVariant
        />

        {/* ───────── 参加コミュ list ───────── */}
        {communities.map((c) => (
          <AvatarItem
            key={c.id}
            label={c.name}
            iconUrl={c.icon_url}
            iconEmoji={c.icon_emoji}
            iconColor={c.icon_color}
            isOfficial={c.is_official}
            isSelected={selectedId === c.id}
            hasContest={!!contestCommunityIds?.has(c.id)}
            onPress={() => onSelect(c.id)}
          />
        ))}

        {/* ───────── empty hint ───────── */}
        {communities.length === 0 && showJoinHint && (
          <View
            style={{
              paddingVertical: SP['3'],
              paddingHorizontal: SP['4'],
              backgroundColor: C.glass,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.glassBorder,
              borderStyle: 'dashed',
            }}
          >
            <Text style={[T.small, { color: C.text3 }]}>
              コミュに参加してね
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ───────── 共有 dock line — 全 avatar が立つ "棚" ───────── */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          backgroundColor: C.divider,
        }}
      />
    </View>
  );
}

// ============================================================
// AvatarItem — 単独 chip (avatar 円 + label)
// ============================================================
type AvatarItemProps = {
  label: string;
  iconUrl?: string | null;
  iconEmoji?: string;
  iconColor?: string;
  isOfficial?: boolean;
  isSelected: boolean;
  onPress: () => void;
  /** 「すべて」(先頭固定) variant. icon と label の見せ方を切替 */
  isAllVariant?: boolean;
  /** コンテスト開催中 → グラデリング + 🏆 バッジ */
  hasContest?: boolean;
};

function AvatarItem({
  label,
  iconUrl,
  iconEmoji,
  iconColor,
  isOfficial,
  isSelected,
  onPress,
  isAllVariant = false,
  hasContest = false,
}: AvatarItemProps) {
  const truncated = truncateLabel(label, LABEL_MAX_CHARS);
  const { C, SHADOW } = useTheme();

  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      scaleValue={0.92}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={isAllVariant ? 'すべての投稿を表示' : label}
      style={{ alignItems: 'center', width: ITEM_WIDTH }}
    >
      <View style={{ position: 'relative' }}>
        {/* ───────── ring (selected = 2pt accent ring, unselected = 1pt border) ─────────
           Apple Stories / Following row 風:
             - 選択時: AVATAR_SIZE = 56 の外円を accent 単色塗り → INNER 52 で 2pt accent ring
             - 未選択: bg2 塗り + 1pt subtle border (C.border) — クッキリ枠を出す
           shadow は全 avatar 共通の SHADOW.xs に抑え、選択時のみ accentGlow を薄く重ねる。
           太い gradient ring + SHADOW.glow は派手すぎ "ぼやけ" の原因だったため廃止。 */}
        {(() => {
          const inner = (
            <View
              style={{
                width: INNER_SIZE,
                height: INNER_SIZE,
                borderRadius: INNER_SIZE / 2,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderWidth: isSelected || hasContest ? 0 : 1,
                borderColor: C.border,
                backgroundColor: isAllVariant ? C.bg3 : iconUrl ? C.bg3 : iconColor || C.bg3,
              }}
            >
              {isAllVariant ? (
                <Icon.community size={26} color={isSelected ? C.accent : C.text2} strokeWidth={2.2} />
              ) : (
                <CommunityIcon size={INNER_SIZE} iconUrl={iconUrl} iconEmoji={iconEmoji} iconColor={iconColor} name={label} />
              )}
            </View>
          );
          const ringBase = {
            width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
            alignItems: 'center' as const, justifyContent: 'center' as const, overflow: 'hidden' as const,
            ...(isSelected ? SHADOW.accentGlow : SHADOW.xs),
          };
          // コンテスト開催中: ブランドグラデのストーリーリング。それ以外: 選択=accent / 通常=bg2。
          return hasContest ? (
            <LinearGradient colors={['#7C6AF7', '#B98CFF', '#E891C7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={ringBase}>
              {inner}
            </LinearGradient>
          ) : (
            <View style={{ ...ringBase, backgroundColor: isSelected ? C.accent : C.bg2 }}>{inner}</View>
          );
        })()}

        {/* ───────── official badge (右下) ───────── */}
        {isOfficial && (
          <View style={{ position: 'absolute', right: -2, bottom: -2, borderWidth: 2, borderColor: C.bg2, borderRadius: R.full }}>
            <OfficialBadge size="sm" iconOnly />
          </View>
        )}
      </View>

      {/* ───────── label (max 8 char + …) ─────────
         iOS native: caption (11pt) を base に固定 → サイズ揺れによる "ぼやけ" を防ぐ。
         選択中だけ weight を上げて accent color、未選択は text2 (subtle)。
         全 chip 共通の letterSpacing で "横並びリズム" を整える。 */}
      <Text
        numberOfLines={1}
        style={[
          T.caption,
          {
            marginTop: 6,
            textAlign: 'center',
            color: isSelected ? C.accent : C.text2,
            fontWeight: isSelected ? '700' : '600',
            letterSpacing: 0.1,
          },
        ]}
      >
        {truncated}
      </Text>

      {/* ───────── selected indicator (連続 tab バー) ─────────
         選択中だけ、共有 dock line の上に短い accent バーを出して "現在地" を示す。
         未選択時はスペースだけ確保 (=同 height) して chip 高さを揃える。 */}
      <View
        style={{
          marginTop: 4,
          height: SELECTED_INDICATOR_HEIGHT,
          width: SELECTED_INDICATOR_WIDTH,
          borderRadius: SELECTED_INDICATOR_HEIGHT / 2,
          backgroundColor: isSelected ? C.accent : 'transparent',
        }}
      />
    </PressableScale>
  );
}

// ------------------------------------------------------------
// helper: label を max char + … で truncate
// ------------------------------------------------------------
function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}
