// ============================================================
// PostCardHeader — 投稿カードのヘッダー行
// ------------------------------------------------------------
// アバター / 投稿者名(or コミュニティ名) / タイムスタンプ / ⋯ メニュー を
// 3 つの viewContext に応じて切り替えて表示する。
//
// viewContext:
//   'home'      (既定) — コミュニティ icon + 名前 (Reddit の r/ サブレ表示スタイル)
//   'community' — 投稿者本人の avatar + 擬似ハンドル (コミュニティ詳細ページ)
//
// 特殊ケース:
//   post.official_author が存在する場合は公式管理者として shield + 実名で表示。
//
// 設計上の注意:
//   - このコンポーネントは STYLES を親から受け取る (makeStyles の返値)。
//     将来的に useColors() を内部で呼んで独自 makeStyles にするのが望ましいが、
//     現時点では AnonPostCard の makeStyles ファクトリと密結合しており、
//     段階的リファクタの一歩目として Props 経由で受け取る方針とする。
//   - ModActionMenu は mod 権限を持つユーザーにのみ表示。
//   - onCommunityPress はコミュニティ詳細への遷移。
//   - onMenuPress は「...」タップ時の handleMoreMenu を渡す。
// ============================================================

import { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Post } from '../../types/models';
import type { PostCommunityRef } from '../../lib/api/posts';
import { useT } from '../../lib/i18n';
import { useColors } from '../../hooks/useColors';
import { R } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { Avatar } from '../ui/Avatar';
import { CommunityIcon } from '../ui/CommunityIcon';
import { OfficialBadge } from '../community/OfficialBadge';
import { ModActionMenu } from '../community/ModActionMenu';
import { PressableScale } from '../ui/PressableScale';
import { formatRelative } from '../../lib/utils/date';
import { pseudonymFor } from '../../lib/utils/pseudonym';

// HIT_SLOP 定数 (モジュールスコープで安定した参照)
const HIT_SLOP_6 = 6;
const HIT_SLOP_10 = 10;

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────
export type PostCardHeaderProps = {
  post: Post;
  viewContext: 'home' | 'community';
  communities: PostCommunityRef[];
  primaryCommunity: PostCommunityRef | undefined;
  pseudonymId: string | null;
  isOwnPost: boolean;
  isMod: boolean;
  // 安定化済みのハンドラ (useCallback で固定化すること)
  onPrimaryCommunityPress: () => void;
  goToPseudoProfile: () => void;
  handleMoreMenu: () => void;
  onModActionComplete: () => void;
};

// ────────────────────────────────────────────────────────────────────
// CommunityInlineIndicator — header 内 1 行に統合した community chip
// ────────────────────────────────────────────────────────────────────
type CommunityInlineIndicatorProps = {
  community: PostCommunityRef;
  extraCount: number;
  onPress: () => void;
};

const makeChipStyles = (bg3: string, border: string, text2: string, text3: string) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
      minWidth: 0,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: 'transparent',
      borderRadius: R.full,
      borderWidth: 1,
      borderColor: border,
    },
    chipName: {
      fontSize: 12,
      lineHeight: 15,
      color: text2,
      fontWeight: '700',
      flexShrink: 1,
    },
    chipExtra: {
      fontSize: 11,
      lineHeight: 14,
      color: text3,
      fontWeight: '600',
    },
    // bg3 は使わないが将来用に残す (backgroundColor: 'transparent' が正)
    _bg3Placeholder: { backgroundColor: bg3 },
  });

function CommunityInlineIndicatorInner({
  community: c,
  extraCount,
  onPress,
}: CommunityInlineIndicatorProps) {
  const C = useColors();
  const S = useMemo(
    () => makeChipStyles(C.bg3, C.border, C.text2, C.text3),
    [C.bg3, C.border, C.text2, C.text3],
  );
  const a11yLabel = useMemo(() => `コミュニティ ${c.name} を開く`, [c.name]);
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      hitSlop={HIT_SLOP_6}
      style={S.chip}
      accessibilityRole="link"
      accessibilityLabel={a11yLabel}
    >
      <CommunityIcon size={18} iconUrl={c.icon_url} iconEmoji={c.icon_emoji} name={c.name} />
      <Text style={S.chipName} numberOfLines={1}>
        {c.name}
      </Text>
      {c.is_official && <OfficialBadge size="sm" iconOnly />}
      {extraCount > 0 && (
        <Text style={S.chipExtra}>{`+${extraCount}`}</Text>
      )}
    </PressableScale>
  );
}
const CommunityInlineIndicator = memo(CommunityInlineIndicatorInner);

// ────────────────────────────────────────────────────────────────────
// makeStyles — PostCardHeader 専用の動的スタイル
// ────────────────────────────────────────────────────────────────────
/* eslint-disable react-native/no-unused-styles */
const makeStyles = (
  text: string,
  text2: string,
  text3: string,
  accentBg: string,
  accent: string,
  border: string,
  divider: string,
) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    officialAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: accentBg,
      borderWidth: 1.5,
      borderColor: accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    officialMeta: { flex: 1, minWidth: 0 },
    officialNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
    },
    officialName: { color: text, fontWeight: '700', letterSpacing: -0.08 },
    officialSub: { color: text3 },
    anonRow: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    anonLabel: { color: text, fontWeight: '800', letterSpacing: -0.08 },
    anonRelative: { color: text3, fontSize: 12, lineHeight: 16 },
    morePress: { padding: 12 },
    anonMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
      maxWidth: '100%',
    },
    anonMetaDot: { color: text3, fontSize: 12, lineHeight: 15 },
    // 使用されているが lint が未使用と誤報するため eslint-disable を使用
    _borderPlaceholder: { borderColor: border },
    _dividerPlaceholder: { borderColor: divider },
    _text2Placeholder: { color: text2 },
  });
/* eslint-enable react-native/no-unused-styles */

// ────────────────────────────────────────────────────────────────────
// PostCardHeader
// ────────────────────────────────────────────────────────────────────
function PostCardHeaderInner({
  post,
  viewContext,
  communities,
  primaryCommunity,
  pseudonymId,
  isOwnPost,
  isMod,
  onPrimaryCommunityPress,
  goToPseudoProfile,
  handleMoreMenu,
  onModActionComplete,
}: PostCardHeaderProps) {
  const t = useT();
  const C = useColors();

  const STYLES = useMemo(
    () =>
      makeStyles(
        C.text,
        C.text2,
        C.text3,
        C.accentBg,
        C.accent,
        C.border,
        C.divider,
      ),
    [C.text, C.text2, C.text3, C.accentBg, C.accent, C.border, C.divider],
  );

  const pseudo = useMemo(() => pseudonymFor(pseudonymId), [pseudonymId]);
  const primaryCommunityId = primaryCommunity?.community_id;

  // memoized style 配列 — 毎 render 新 array を作らない
  // 注: as const は readonly tuple を作り StyleProp<TextStyle> に非互換になるため使わない
  const officialNameStyle = useMemo(
    () => [T.smallM, STYLES.officialName],
    [STYLES.officialName],
  );
  const officialSubStyle = useMemo(
    () => [T.caption, STYLES.officialSub],
    [STYLES.officialSub],
  );
  const anonLabelStyle = useMemo(
    () => [T.smallM, STYLES.anonLabel],
    [STYLES.anonLabel],
  );
  // 擬似ハンドルの色は pseudo.color に依存するため別途 memoize
  const pseudoLabelStyle = useMemo(
    () => [T.smallM, STYLES.anonLabel, { color: pseudo.color }],
    [STYLES.anonLabel, pseudo.color],
  );

  // modActionTarget は post.id が変わる時のみ新規
  const modActionTarget = useMemo(
    () => ({ kind: 'post' as const, postId: post.id }),
    [post.id],
  );

  return (
    <View style={STYLES.headerRow}>
      {/* ===== アバター ===== */}
      {post.official_author ? (
        // 公式管理者: shield アイコン
        <View style={STYLES.officialAvatar} accessibilityLabel="公式管理者">
          <Icon.shield size={20} color={C.accent} strokeWidth={2.4} />
        </View>
      ) : viewContext === 'community' ? (
        // コミュニティ詳細: 投稿者本人のアバター + 擬似ハンドル (de-anon Phase2)
        <PressableScale onPress={goToPseudoProfile} hitSlop={4} disabled={!pseudonymId}>
          <Avatar
            size={40}
            uri={post.avatar_url}
            emoji={post.avatar_url ? undefined : post.avatar_emoji}
            color={pseudo.color}
            name={pseudo.initial}
          />
        </PressableScale>
      ) : (
        // ホーム/デフォルト: コミュニティアイコン (タップでコミュニティへ遷移)
        <PressableScale
          onPressIn={undefined}
          onPress={onPrimaryCommunityPress}
          hitSlop={4}
          disabled={!primaryCommunity}
        >
          <CommunityIcon
            size={40}
            iconUrl={primaryCommunity?.icon_url}
            iconEmoji={primaryCommunity?.icon_emoji}
            name={primaryCommunity?.name}
          />
        </PressableScale>
      )}

      {/* ===== メタ (名前 + 時刻) ===== */}
      {post.official_author ? (
        // 公式管理者
        <View style={STYLES.officialMeta}>
          <View style={STYLES.officialNameRow}>
            <Text style={officialNameStyle} numberOfLines={1}>
              {post.official_author.name || t('公式管理者')}
            </Text>
          </View>
          <View style={STYLES.anonMetaRow}>
            <Text style={officialSubStyle} numberOfLines={1}>
              {post.official_author.organization
                ? `${post.official_author.organization} · ${formatRelative(post.created_at)}`
                : formatRelative(post.created_at)}
            </Text>
            {primaryCommunity && (
              <>
                <Text style={STYLES.anonMetaDot}>·</Text>
                <CommunityInlineIndicator
                  community={primaryCommunity}
                  extraCount={communities.length - 1}
                  onPress={onPrimaryCommunityPress}
                />
              </>
            )}
          </View>
        </View>
      ) : viewContext === 'community' ? (
        // コミュニティ詳細: 投稿者の擬似ハンドル (tap で擬似プロフィール) + 時刻
        <View style={STYLES.anonRow}>
          <PressableScale
            onPress={goToPseudoProfile}
            disabled={!pseudonymId}
            scaleValue={0.98}
          >
            <Text style={pseudoLabelStyle} numberOfLines={1}>
              {pseudo.handle}
            </Text>
          </PressableScale>
          <View style={STYLES.anonMetaRow}>
            <Text style={STYLES.anonRelative} numberOfLines={1}>
              {formatRelative(post.created_at)}
            </Text>
          </View>
        </View>
      ) : (
        // ホーム/デフォルト: コミュニティ名 (タップ可) + 時刻
        <View style={STYLES.anonRow}>
          <PressableScale
            onPress={onPrimaryCommunityPress}
            disabled={!primaryCommunity}
            scaleValue={0.98}
          >
            <Text style={anonLabelStyle} numberOfLines={1}>
              {primaryCommunity?.name ?? t('コミュニティ')}
            </Text>
          </PressableScale>
          <View style={STYLES.anonMetaRow}>
            <Text style={STYLES.anonRelative} numberOfLines={1}>
              {formatRelative(post.created_at)}
            </Text>
            {communities.length > 1 && (
              <>
                <Text style={STYLES.anonMetaDot}>·</Text>
                <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                  +{communities.length - 1}
                </Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* ⋯ メニュー */}
      <PressableScale
        onPress={handleMoreMenu}
        hitSlop={HIT_SLOP_10}
        style={STYLES.morePress}
        accessibilityLabel="その他のオプション"
        accessibilityRole="button"
      >
        <Icon.more size={20} color={C.text3} strokeWidth={2.2} />
      </PressableScale>

      {/* mod 専用 3-dot menu — mod でない / 自分の投稿のときは null render */}
      {primaryCommunityId && isMod && (
        <ModActionMenu
          target={modActionTarget}
          isMod={isMod}
          isOwn={isOwnPost}
          onActionComplete={onModActionComplete}
        />
      )}
    </View>
  );
}

export const PostCardHeader = memo(PostCardHeaderInner);
