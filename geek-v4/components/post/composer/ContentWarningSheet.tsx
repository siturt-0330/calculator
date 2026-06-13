// ============================================================
// ContentWarningSheet — コンテンツ警告 (CW) を付けるボトムシート
// ------------------------------------------------------------
// composer の「コンテンツ警告」ボタンから開く、画面下からせり上がる modal
// シート。投稿に CW カテゴリ (ネタバレ / センシティブ / 暴力的 / 注意) を 1 つ
// 選び、任意で警告メッセージを添えられる。何も選ばなければ警告なし。
//
// カテゴリの value / 日本語ラベルは app/post/create.tsx の CW_OPTIONS と
// "完全一致" させてある (アプリ全体で表記を揃えるため):
//   spoiler → ネタバレ / nsfw → センシティブ / violence → 暴力的 / sensitive → 注意
// CwCategory 型は lib/api/posts.ts から export されていない (createPost が
// inline union で受けるのみ) ため、本 file で定義して export する。値は
// createPost の cwCategory 引数 ('spoiler'|'nsfw'|'violence'|'sensitive'|null)
// とそのまま互換。
//
// 純粋な presentational component (fully controlled):
//   - 状態は props (visible / category / text)
//   - アクションは callback (onCategoryChange / onTextChange / onClose)
//   - テーマは useColors()
//   - supabase / zustand / fetch / navigation は一切持たない
//
// 警告は "注意喚起" であって "エラー" ではないので、選択中の chip は赤ではなく
// amber トーン (bg amberBg / border amber / text amber) で表現する。
//
// シート構造は共有 Sheet component がまだ無いため、本 file 内で完結:
//   Modal(transparent) → Animated backdrop(FadeIn/Out) → Animated panel
//   (SlideInDown/SlideOutDown)。背面に全面 Pressable を置いて外側タップで閉じる。
//   TextInput を含むため content は KeyboardAvoidingView で包む。
// ============================================================

import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Eye, EyeOff, Flag } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useColors } from '../../../hooks/useColors';
import { useWebKeyboardInset } from '../../../hooks/useWebKeyboardInset';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { hap } from '../../../design/haptics';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../ui/PressableScale';
import { Input } from '../../ui/Input';
// ★ 2026-06-12 P0-2: grabber を「引っ張れる契約」にする
import { SheetSwipeDown } from '../../ui/SheetSwipeDown';

/**
 * コンテンツ警告のカテゴリ。
 * createPost (lib/api/posts.ts) の cwCategory 引数と互換:
 *   'spoiler' | 'nsfw' | 'violence' | 'sensitive' | null
 * 同型は posts.ts から export されていないため、ここで定義して共有する。
 */
export type CwCategory = 'spoiler' | 'nsfw' | 'violence' | 'sensitive';

export interface ContentWarningSheetProps {
  /** シートの表示状態 */
  visible: boolean;
  /** シートを閉じる (背景タップ / X / 戻る) */
  onClose: () => void;
  /** 現在選択中の CW カテゴリ。未選択なら null */
  category: CwCategory | null;
  /** カテゴリが変わったとき。選択中の chip を再タップすると null (トグル off) */
  onCategoryChange: (c: CwCategory | null) => void;
  /** 警告メッセージ (任意) の現在値 */
  text: string;
  /** 警告メッセージが変わったとき */
  onTextChange: (t: string) => void;
}

// ------------------------------------------------------------
// CW カテゴリ option — app/post/create.tsx の CW_OPTIONS と value / label を
// 完全一致させている。アイコンは各カテゴリの意味に寄せて付与。
//   spoiler  → ネタバレ   (EyeOff: 見えないように隠す)
//   nsfw     → センシティブ (Eye:   閲覧注意)
//   violence → 暴力的     (Flag:  通報/フラグ)
//   sensitive→ 注意       (AlertTriangle: 一般的な注意)
// ------------------------------------------------------------
type CwRow = {
  value: CwCategory;
  label: string;
  IconComp: LucideIcon;
};

const CW_OPTIONS: CwRow[] = [
  { value: 'spoiler', label: 'ネタバレ', IconComp: EyeOff },
  { value: 'nsfw', label: 'センシティブ', IconComp: Eye },
  { value: 'violence', label: '暴力的', IconComp: Flag },
  { value: 'sensitive', label: '注意', IconComp: AlertTriangle },
];

export function ContentWarningSheet({
  visible,
  onClose,
  category,
  onCategoryChange,
  text,
  onTextChange,
}: ContentWarningSheetProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  // web: ソフトキーボード高さ (native は 0)。RNW の KeyboardAvoidingView は no-op
  // なので scrim の下 padding に足して sheet をキーボードの上へ持ち上げる。
  const webKeyboardInset = useWebKeyboardInset();

  // chip タップ — 既に選択中なら null に戻す (トグル off)、それ以外は選択。
  const handleSelect = (v: CwCategory) => {
    hap.select();
    onCategoryChange(category === v ? null : v);
  };

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
    >
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          justifyContent: 'flex-end',
          // web のみ: キーボード高さ分 content box を縮め、sheet をキーボード上端へ。
          paddingBottom: webKeyboardInset,
        }}
      >
        {/* 背面の全面タップ領域 — パネルの後ろに敷いて外側タップで閉じる */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
        />

        {/* TextInput を含むのでキーボードでパネルを持ち上げる */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
          <SheetSwipeDown onClose={onClose}>
          <Animated.View
            entering={SlideInDown.duration(260)}
            exiting={SlideOutDown.duration(200)}
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R.xl,
              borderTopRightRadius: R.xl,
              // キーボード表示中 (web) は home indicator 用 safe-area を足さない。
              paddingBottom: (webKeyboardInset > 0 ? 0 : insets.bottom) + SP['3'],
              maxHeight: '92%',
            }}
          >
            {/* ドラッグハンドル */}
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: R.full,
                backgroundColor: C.border2,
                alignSelf: 'center',
                marginTop: SP['3'],
                marginBottom: SP['2'],
              }}
            />

            {/* ヘッダー: warn アイコン + タイトル + 閉じる */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                paddingHorizontal: SP['4'],
                paddingTop: SP['1'],
                paddingBottom: SP['3'],
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: R.md,
                  backgroundColor: C.amberBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon.warn size={18} color={C.amber} strokeWidth={2.4} />
              </View>
              <Text style={[T.h3, { color: C.text, flex: 1 }]} numberOfLines={1}>
                コンテンツ警告
              </Text>
              <PressableScale
                onPress={onClose}
                haptic="tap"
                accessibilityRole="button"
                accessibilityLabel="閉じる"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: R.full,
                  backgroundColor: C.bg3,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon.close size={18} color={C.text3} strokeWidth={2.4} />
              </PressableScale>
            </View>

            <View style={{ paddingHorizontal: SP['4'], gap: SP['4'] }}>
              {/* 説明 */}
              <Text style={[T.small, { color: C.text3 }]}>
                閲覧前に警告を表示します。何も選ばなければ警告なしで投稿されます。
              </Text>

              {/* カテゴリ chip 群 */}
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: SP['2'],
                }}
                accessibilityRole="radiogroup"
              >
                {CW_OPTIONS.map((opt) => {
                  const selected = category === opt.value;
                  const I = opt.IconComp;
                  return (
                    <PressableScale
                      key={opt.value}
                      onPress={() => handleSelect(opt.value)}
                      scaleValue={0.97}
                      accessibilityRole="radio"
                      accessibilityLabel={`コンテンツ警告: ${opt.label}`}
                      accessibilityState={{ selected }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: SP['2'],
                        paddingVertical: SP['2'],
                        paddingHorizontal: SP['3'],
                        borderRadius: R.full,
                        backgroundColor: selected ? C.amberBg : C.bg3,
                        borderWidth: 1.5,
                        borderColor: selected ? C.amber : C.border,
                      }}
                    >
                      <I
                        size={16}
                        color={selected ? C.amber : C.text2}
                        strokeWidth={2.4}
                      />
                      <Text style={[T.smallM, { color: selected ? C.amber : C.text2 }]}>
                        {opt.label}
                      </Text>
                      {selected && (
                        <Icon.check size={16} color={C.amber} strokeWidth={2.6} />
                      )}
                    </PressableScale>
                  );
                })}
              </View>

              {/* 任意の警告メッセージ */}
              <Input
                label="警告メッセージ (任意)"
                placeholder="例: 鬼滅 無限城編のネタバレを含みます"
                value={text}
                onChangeText={onTextChange}
                maxLength={200}
                accessibilityLabel="警告メッセージ (任意)"
              />
            </View>
          </Animated.View>
          </SheetSwipeDown>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}
