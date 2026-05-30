// =============================================================================
// EditorialIconPicker — EDITORIAL「特集」蔵書票(bookplate)アイコン選択
// -----------------------------------------------------------------------------
// 役割: コミュニティ作成の「アイコン画像(必須)」を司書台帳の蔵書票として選ばせる。
//   - 中央に径 96 の円(borderRadius=半径48 / overflow hidden / borderWidth1 C.border /
//     backgroundColor C.bg2)。塗りカードや濃い影は持たず、罫線と余白で語る EDITORIAL。
//   - uri があれば ExpoImage(contentFit 'cover')、無ければ中央に Icon.image(size40 C.text4)。
//   - loading 中は円中央に ActivityIndicator(react-native / color C.accent)。
//   - 円の下に PressableScale の下線リンク「アイコンを選ぶ / 変更」(uri 有無で label 切替。
//     塗りボタンにせず accent 文字+下線=特集の所作)。uri && onRemove があれば「削除」リンク。
//   - 最下に caption「写真 / 画像ファイル (JPEG / PNG / WebP / GIF · 5MB まで)」(C.text3)。
//
// 規約:
//   - presentational に徹する(fetch/router/store を持たない。すべて props)。
//   - 和文(アイコンを選ぶ/変更/削除/キャプション)は FONT.jp 系。英字は使わない構成。
//   - 存在しない Icon/トークン禁止・any 禁止・未使用 import 禁止。
//   - BlurView 不使用(フラット = Web 同一品質)。reduce-motion は entering を退避。
// =============================================================================

import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';

import { C, SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';

// -----------------------------------------------------------------------------
// constants — 蔵書票の径(SIZE.avatarXl=96)。半径はその 1/2。
// -----------------------------------------------------------------------------
const CIRCLE = SIZE.avatarXl; // 96
const RADIUS = CIRCLE / 2; // 48

// -----------------------------------------------------------------------------
// props — すべて親注入(presentational)
// -----------------------------------------------------------------------------
export interface EditorialIconPickerProps {
  /** 選択済みアイコンの URI。未選択なら null。 */
  uri: string | null;
  /** アップロード/処理中。円中央に ActivityIndicator を出す。 */
  loading?: boolean;
  /** 「アイコンを選ぶ / 変更」押下。画像ピッカーを開く想定(親が実装)。 */
  onPick: () => void;
  /** 「削除」押下。渡され、かつ uri がある時だけ削除リンクを描画。 */
  onRemove?: () => void;
}

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------
export function EditorialIconPicker({
  uri,
  loading = false,
  onPick,
  onRemove,
}: EditorialIconPickerProps) {
  const reduceMotion = useReducedMotion();

  const hasIcon = uri !== null && uri.length > 0;
  const pickLabel = hasIcon ? 'アイコンを変更' : 'アイコンを選ぶ';
  const showRemove = hasIcon && typeof onRemove === 'function';

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.delay(60).duration(220)}
      style={styles.root}
    >
      {/* 蔵書票の円: 罫線一本 + bg2。押下でピッカーを開く。 */}
      <PressableScale
        onPress={onPick}
        haptic="select"
        disabled={loading}
        style={styles.circle}
        accessibilityRole="button"
        accessibilityLabel={hasIcon ? 'アイコン画像を変更' : 'アイコン画像を選択'}
      >
        {/* 画像(あれば最下層に敷く。円の overflow hidden でクリップ) */}
        {hasIcon ? (
          <ExpoImage
            source={{ uri }}
            contentFit="cover"
            transition={220}
            style={styles.image}
            accessibilityLabel="選択中のアイコン"
          />
        ) : (
          // 未選択: 中央にプレースホルダ画像アイコン
          <Icon.image size={40} color={C.text4} />
        )}

        {/* loading: 円中央に紫の ActivityIndicator を重ねる(画像/プレースホルダの上) */}
        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={C.accent} />
          </View>
        ) : null}
      </PressableScale>

      {/* 操作リンク行(塗りボタンにせず下線リンク=特集の所作) */}
      <View style={styles.links}>
        <PressableScale
          onPress={onPick}
          haptic="tap"
          disabled={loading}
          style={styles.linkBtn}
          accessibilityRole="button"
          accessibilityLabel={pickLabel}
        >
          <Text style={styles.linkText}>{pickLabel}</Text>
          {/* accent 下線(文字幅に合わせる) */}
          <View style={styles.linkUnderline} />
        </PressableScale>

        {showRemove ? (
          <PressableScale
            onPress={onRemove}
            haptic="warn"
            disabled={loading}
            style={styles.removeBtn}
            accessibilityRole="button"
            accessibilityLabel="アイコンを削除"
          >
            <Text style={styles.removeText}>削除</Text>
          </PressableScale>
        ) : null}
      </View>

      {/* 最下: 受け付ける形式・容量のキャプション */}
      <Text style={styles.caption}>
        写真 / 画像ファイル (JPEG / PNG / WebP / GIF · 5MB まで)
      </Text>
    </Animated.View>
  );
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  // 水平中央・縦積み
  root: {
    alignItems: 'center',
  },
  // 蔵書票の円(罫線一本 + bg2 / overflow hidden で画像をクリップ)
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: RADIUS,
  },
  // loading の覆い(円いっぱいに薄い暗幕を敷き中央へインジケータ)
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.scrimLight,
  },
  // リンク行(選ぶ/変更 + 任意で 削除)
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['4'],
    marginTop: SP['3'],
  },
  linkBtn: {
    alignItems: 'center',
  },
  linkText: {
    ...T.smallM,
    color: C.accentLight,
  },
  linkUnderline: {
    alignSelf: 'stretch',
    height: 1,
    backgroundColor: C.accent,
    marginTop: 3,
  },
  removeBtn: {
    alignItems: 'center',
  },
  removeText: {
    ...T.smallM,
    color: C.text3,
  },
  caption: {
    ...T.caption,
    color: C.text3,
    marginTop: SP['3'],
    textAlign: 'center',
  },
});

export default EditorialIconPicker;
