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
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { R, SP } from '../../design/tokens';
import { useTheme } from '../../hooks/useColors';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { OfficialBadge } from './OfficialBadge';
import { thumbedUrl } from '../../lib/utils/imageUrl';

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
const AVATAR_SIZE = 56;
const INNER_SIZE = 50;        // ring (2px x2) 内側
const ITEM_WIDTH = 72;        // chip 1 つ分の幅 (avatar + label)
const LABEL_MAX_CHARS = 8;

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
};

// ============================================================
// CommunityAvatarBar
// ============================================================
export function CommunityAvatarBar({
  communities,
  selectedId,
  onSelect,
  showJoinHint = true,
}: Props) {
  const isAllSelected = selectedId === null;
  const { C } = useTheme();

  return (
    <View
      style={{
        backgroundColor: C.bg2,
        borderBottomWidth: 1,
        borderBottomColor: C.divider,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
          gap: SP['3'],
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
}: AvatarItemProps) {
  const truncated = truncateLabel(label, LABEL_MAX_CHARS);
  const { C, GRAD, SHADOW } = useTheme();

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
        {/* ───────── ring (selected = gradient, unselected = border) ───────── */}
        <View
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: AVATAR_SIZE / 2,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            ...(isSelected ? SHADOW.glow : SHADOW.xs),
          }}
        >
          {isSelected ? (
            <LinearGradient
              colors={GRAD.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
              }}
            />
          ) : (
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                backgroundColor: C.border,
              }}
            />
          )}

          {/* ───────── 内側 (avatar 本体) ───────── */}
          <View
            style={{
              width: INNER_SIZE,
              height: INNER_SIZE,
              borderRadius: INNER_SIZE / 2,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              backgroundColor: isAllVariant
                ? C.bg3
                : iconUrl
                  ? C.bg3
                  : iconColor || C.bg3,
            }}
          >
            {isAllVariant ? (
              // 「すべて」: community icon (Users2)
              <Icon.community
                size={26}
                color={isSelected ? C.accentLight : C.text2}
                strokeWidth={2.2}
              />
            ) : iconUrl ? (
              <ExpoImage
                source={{ uri: thumbedUrl(iconUrl, 160) }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={120}
              />
            ) : (
              <Text style={{ fontSize: 26 }}>{iconEmoji ?? '🌐'}</Text>
            )}
          </View>
        </View>

        {/* ───────── official badge (右下) ───────── */}
        {isOfficial && (
          <View
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              borderWidth: 2,
              borderColor: C.bg2,
              borderRadius: R.full,
            }}
          >
            <OfficialBadge size="sm" iconOnly />
          </View>
        )}
      </View>

      {/* ───────── label (max 8 char + …) ───────── */}
      <Text
        numberOfLines={1}
        style={[
          isSelected ? T.smallM : T.caption,
          {
            marginTop: 6,
            textAlign: 'center',
            color: isSelected ? C.accentLight : C.text2,
            fontWeight: isSelected ? '700' : '600',
          },
        ]}
      >
        {truncated}
      </Text>
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
