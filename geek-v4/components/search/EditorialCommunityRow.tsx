// ============================================================
// EditorialCommunityRow — EDITORIAL「特集」検索タブのコミュ行
// ------------------------------------------------------------
// コミュニティ 1 件を「名鑑エントリ」風の罫線リスト行として描画する。
// - 上辺 hairline + paddingVertical で雑誌の索引のような密度感
// - 左: Avatar(44) / 中央: 名前(+公式バッジ) + 説明 + メンバー数 / 右: chevron
// - 検索語 (terms) は HighlightedText で紫マーカー強調 (エディトリアル基調)
// - tap は親から渡る onPress (useRouter は持たない = 結線は呼び出し側)
// - entering は rank に応じて段階ディレイ (上から順に降りてくる)
//
// 設計メモ:
//   * 行コンポーネントなので Avatar は size 44 (avatarLg=56 はカード/ヒーロー用)。
//   * is_official バッジは BadgeCheck が icon registry に無いため
//     Icon.check (CheckCircle2) を C.accent で代用 (icons.ts の規約どおり)。
//   * BlurView 不使用 / フラット (Web と同一品質)。iOS/Android/Web 共通。
// ============================================================
import { View, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { C, SP } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Avatar } from '../ui/Avatar';
import { HighlightedText } from '../ui/HighlightedText';
import { Icon } from '../../constants/icons';
import type { CommunityHit } from '../../lib/api/communities';

// rank に応じた段階 entering ディレイ。8 件目以降は頭打ち (一気に出す)。
const MAX_STAGGER_INDEX = 8;
const STAGGER_STEP_MS = 40;
const ENTER_DURATION_MS = 260;

// 行アバターのサイズ (avatarLg=56 はヒーロー用なので、行は 44 で密度を保つ)。
const ROW_AVATAR_SIZE = 44;

export function EditorialCommunityRow({
  community,
  rank,
  terms,
  onPress,
}: {
  community: CommunityHit;
  rank: number;
  terms: string[];
  onPress: () => void;
}) {
  const { name, description, icon_url, icon_emoji, icon_color, member_count, is_official } =
    community;

  const enterDelay = Math.min(rank, MAX_STAGGER_INDEX) * STAGGER_STEP_MS;

  return (
    <Animated.View
      entering={FadeInDown.delay(enterDelay).duration(ENTER_DURATION_MS)}
      style={{ borderTopWidth: 1, borderTopColor: C.divider }}
    >
      <PressableScale
        onPress={onPress}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel={`コミュニティを開く: ${name}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          paddingVertical: SP['4'],
        }}
      >
        {/* 左: アバター (icon_url 優先 / なければ emoji / さらに無ければ頭文字) */}
        <Avatar
          size={ROW_AVATAR_SIZE}
          uri={icon_url || undefined}
          emoji={icon_emoji}
          color={icon_color}
          name={name}
        />

        {/* 中央: 名前 + (公式) / 説明 / メンバー数 */}
        <View style={{ flex: 1, gap: SP['1'] }}>
          {/* 名前行 — 公式バッジは名前の直後に小さく添える */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
            <View style={{ flexShrink: 1 }}>
              <HighlightedText
                text={name}
                terms={terms}
                numberOfLines={1}
                style={[T.h4, { fontFamily: FONT.jpB, color: C.text }]}
              />
            </View>
            {is_official ? <Icon.check size={13} color={C.accent} strokeWidth={2.4} /> : null}
          </View>

          {/* 説明 (あるときだけ 1 行) */}
          {description ? (
            <HighlightedText
              text={description}
              terms={terms}
              numberOfLines={1}
              style={[T.small, { color: C.text2 }]}
            />
          ) : null}

          {/* メンバー数 */}
          <Text style={[T.captionM, { color: C.text3 }]}>
            {member_count.toLocaleString('ja-JP')}人
          </Text>
        </View>

        {/* 右: chevron */}
        <Icon.chevronR size={18} color={C.text4} strokeWidth={2.2} />
      </PressableScale>
    </Animated.View>
  );
}
