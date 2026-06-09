import { memo, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '../../hooks/useColors';
import type { ColorPalette } from '../../lib/theme/palettes';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

// ============================================================
// QuotePostMini — 引用投稿のコンパクトプレビュー
// ------------------------------------------------------------
// 引用元投稿を丸角ボーダーボックスで表示する。
// AnonPostCard の本文エリア内や他のカードコンポーネントに
// 埋め込んで使う想定。
//
// Props:
//   post     — 引用元投稿データ (null なら削除済プレースホルダを表示)
//   onPress  — ボックスタップ時のハンドラ (省略可)
//
// 表示内容:
//   - title (BBS スレタイトル) がある場合は太字で先頭表示 (1 行)
//   - content の先頭 2 行 (numberOfLines=2 で省略)
//   - tag_names の先頭 2 件をチップ表示
//
// スタイル方針:
//   - X/Twitter 風のシンプルな引用ブロック
//   - 背景 C.bg3 (カード bg より 1 段暗い) で視覚的に区別
//   - borderRadius 12 + C.border hairline (1px)
//   - 内側 padding SP['3'] (12px)
//   - テキストは T.smallM で compact
// ============================================================

const MAX_TAG_CHIPS = 2;

type QuotePostMiniPost = {
  id: string;
  content?: string;
  title?: string;
  tag_names?: string[];
  created_at?: string;
};

type QuotePostMiniProps = {
  post: QuotePostMiniPost | null;
  onPress?: () => void;
};

/* eslint-disable react-native/no-unused-styles */
const makeStyles = (C: ColorPalette) =>
  StyleSheet.create({
    // 外枠ボックス — 引用ブロック全体 (X/Twitter 風シンプルデザイン)
    container: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg3,
      padding: SP['3'],
      gap: SP['1'],
    },
    // タイトル行 (BBS スレタイ) — T.smallM ベースで font-family 統一
    title: {
      color: C.text,
      fontWeight: '700',
      letterSpacing: -0.1,
    },
    // 本文プレビュー — T.caption を外して font-family 競合を排除
    content: {
      color: C.text2,
      fontSize: 13,
      lineHeight: 18,
    },
    // 削除済みプレースホルダ
    deleted: {
      color: C.text3,
      fontSize: 13,
      lineHeight: 18,
      fontStyle: 'italic',
    },
    // タグ群の行 — container gap だけで間隔を取る (marginTop は重複するため除去)
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SP['1'],
    },
    // タグチップ — C.bg4 背景で container bg との対比を明確に
    tagChip: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: C.border2 ?? C.border,
      backgroundColor: C.bg4 ?? C.bg3,
    },
    // タグテキスト — C.text2 (WCAG AA 準拠, dark 7.72:1 / light 7.73:1)
    tagChipText: {
      fontSize: 11,
      lineHeight: 14,
      color: C.text2,
      fontWeight: '600',
    },
  });
/* eslint-enable react-native/no-unused-styles */

function QuotePostMiniInner({ post, onPress }: QuotePostMiniProps) {
  const C = useColors();
  const STYLES = useMemo(() => makeStyles(C), [C]);

  const visibleTags = useMemo(
    () => (post?.tag_names ?? []).slice(0, MAX_TAG_CHIPS),
    [post?.tag_names],
  );

  const inner =
    post === null ? (
      // 削除済み投稿 — アクセシビリティラベル付きでコンテキストを提供
      <View
        accessible={true}
        accessibilityLabel="引用元の投稿は削除されました"
      >
        <Text style={STYLES.deleted}>元の投稿は削除されました</Text>
      </View>
    ) : (
      <>
        {/* BBS タイトル — T.smallM で font-family 統一、1 行に収める */}
        {!!post.title && (
          <Text style={[T.smallM, STYLES.title]} numberOfLines={1}>
            {post.title}
          </Text>
        )}

        {/* 本文プレビュー — 2 行に制限、font-family 競合なし */}
        {!!post.content && (
          <Text style={STYLES.content} numberOfLines={2} ellipsizeMode="tail">
            {post.content.trim()}
          </Text>
        )}

        {/* タグチップ — 最大 2 件 */}
        {visibleTags.length > 0 && (
          <View style={STYLES.tagsRow}>
            {visibleTags.map((tag) => (
              <View key={tag} style={STYLES.tagChip}>
                <Text style={STYLES.tagChipText}>#{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </>
    );

  if (onPress) {
    return (
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          onPress();
        }}
        style={({ pressed }) => [
          STYLES.container,
          pressed && { opacity: 0.75 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="引用元の投稿を見る"
      >
        {inner}
      </Pressable>
    );
  }

  return <View style={STYLES.container}>{inner}</View>;
}

export const QuotePostMini = memo(QuotePostMiniInner);
