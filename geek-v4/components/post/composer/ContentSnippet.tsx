// ============================================================
// components/post/composer/ContentSnippet.tsx
// ============================================================
// 投稿作成 Step 2 (設定画面) 上部に表示する、下書き内容のコンパクトな読み取り専用プレビュー。
//
// 設計:
//   - usePostDraftStore から title / content / images / video を selector で読む。
//   - 左端に 3px のアクセントカラーのボーダーを引き、"草稿" らしい雰囲気を出す。
//   - 画像がある場合は左に 52×52 のサムネイルを表示。
//   - テキスト列は flex:1 で残幅を使い切る。
//   - プレスハンドラ無し (pure display)。
// ============================================================

import { View, Text, Image, StyleSheet } from 'react-native';
import { useColors } from '../../../hooks/useColors';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { usePostDraftStore } from '../../../stores/postDraftStore';

const THUMB_SIZE = 52;

export function ContentSnippet() {
  const C = useColors();

  // selector で必要な 4 フィールドだけ購読 (全 destructure を避ける)
  const title = usePostDraftStore((s) => s.title);
  const content = usePostDraftStore((s) => s.content);
  const images = usePostDraftStore((s) => s.images);
  const video = usePostDraftStore((s) => s.video);

  const hasTitle = title.trim().length > 0;
  const hasContent = content.trim().length > 0;
  const hasImages = images.length > 0;
  const hasVideo = video !== null;
  const hasAnything = hasTitle || hasContent || hasImages || hasVideo;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: C.bg2,
          borderLeftColor: C.accent,
        },
      ]}
    >
      {/* 左: サムネイル (画像がある場合のみ) */}
      {hasImages && (
        <Image
          source={{ uri: images[0] }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      )}

      {/* 右: テキスト列 */}
      <View style={styles.textBlock}>
        {hasAnything ? (
          <>
            {/* タイトル */}
            {hasTitle && (
              <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
                {title}
              </Text>
            )}

            {/* 本文プレビュー */}
            {hasContent && (
              <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>
                {content}
              </Text>
            )}

            {/* メディアバッジ行 */}
            {(hasImages || hasVideo) && (
              <View style={styles.badgeRow}>
                {hasImages && (
                  <Text style={[T.caption, { color: C.text3 }]}>
                    {`📷 ${images.length}枚`}
                  </Text>
                )}
                {hasVideo && (
                  <Text style={[T.caption, { color: C.text3 }]}>
                    🎬 動画
                  </Text>
                )}
              </View>
            )}
          </>
        ) : (
          /* 何もない場合のフォールバック */
          <Text style={[T.small, { color: C.text3 }]}>内容なし</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: SP['3'],
    padding: SP['3'],
    borderRadius: R.md,
    borderLeftWidth: 3,
    alignItems: 'flex-start',
  },
  thumbnail: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: R.sm,
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: SP['1'],
  },
});
