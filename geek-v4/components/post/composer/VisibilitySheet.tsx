// ============================================================
// VisibilitySheet — 公開範囲を選ぶボトムシート (X + Reddit 融合)
// ------------------------------------------------------------
// composer の CommunityPill / 公開範囲ボタンから開く、画面下からせり上がる
// modal シート。公開範囲 (public / community_public / community_only /
// private) を 1 行ずつ縦に並べ、タップで即選択 → 自動で閉じる。
//
// option の value / 日本語ラベル / 説明 / アイコンは app/post/create.tsx の
// VISIBILITY_OPTIONS と "完全一致" させてある (アプリ全体で表記を揃えるため)。
// PostVisibility 型も create.tsx と同じ '../../../lib/api/posts' から取る。
//
// 純粋な presentational component:
//   - 状態は props (visible / value)
//   - アクションは callback (onChange / onClose)
//   - テーマは useColors()
//   - supabase / zustand / fetch / navigation は一切持たない
//
// シート構造は共有 Sheet component がまだ無いため、本 file 内で完結:
//   Modal(transparent) → Animated backdrop(FadeIn/Out) → Animated panel
//   (SlideInDown/SlideOutDown)。背面に全面 Pressable を置いて外側タップで閉じる。
// ============================================================

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Globe, Lock, Megaphone, Users2 } from 'lucide-react-native';

import { useColors } from '../../../hooks/useColors';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { hap } from '../../../design/haptics';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../ui/PressableScale';
// ★ 2026-06-12 P0-2: grabber を「引っ張れる契約」にするため SheetSwipeDown を被せる
import { SheetSwipeDown } from '../../ui/SheetSwipeDown';
import type { PostVisibility } from '../../../lib/api/posts';

export interface VisibilitySheetProps {
  /** シートの表示状態 */
  visible: boolean;
  /** 現在選択中の公開範囲 */
  value: PostVisibility;
  /** 公開範囲が選ばれたとき (選択直後にシートは閉じる) */
  onChange: (v: PostVisibility) => void;
  /** シートを閉じる (背景タップ / X / 戻る) */
  onClose: () => void;
}

// ------------------------------------------------------------
// 公開範囲 option — app/post/create.tsx の VISIBILITY_OPTIONS と完全一致。
// (value / label / desc / icon を 1 文字も変えずに転記している)
// ------------------------------------------------------------
type VisibilityRow = {
  value: PostVisibility;
  label: string;
  desc: string;
  IconComp: typeof Lock;
};

const VISIBILITY_OPTIONS: VisibilityRow[] = [
  { value: 'public', label: '一般公開', desc: 'ホームに公開', IconComp: Globe },
  { value: 'community_public', label: '全員公開', desc: 'ホーム + コミュニティ', IconComp: Megaphone },
  { value: 'community_only', label: 'コミュ限定', desc: 'メンバーだけに公開', IconComp: Users2 },
  { value: 'private', label: '自分だけ', desc: '下書きとして保存', IconComp: Lock },
];

export function VisibilitySheet({ visible, value, onChange, onClose }: VisibilitySheetProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();

  const handleSelect = (v: PostVisibility) => {
    hap.select();
    onChange(v);
    onClose();
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
        style={{ flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' }}
      >
        {/* 背面の全面タップ領域 — パネルの後ろに敷いて外側タップで閉じる */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
        />

        <SheetSwipeDown onClose={onClose}>
        <Animated.View
          entering={SlideInDown.duration(260)}
          exiting={SlideOutDown.duration(200)}
          style={{
            backgroundColor: C.bg2,
            borderTopLeftRadius: R['2xl'],
            borderTopRightRadius: R['2xl'],
            paddingBottom: insets.bottom + SP['3'],
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

          {/* ヘッダー: タイトル + 閉じる */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: SP['4'],
              paddingTop: SP['1'],
              paddingBottom: SP['3'],
            }}
          >
            <Text style={[T.h3, { color: C.text }]}>公開範囲</Text>
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

          {/* option 行 */}
          <View style={{ paddingHorizontal: SP['3'], gap: SP['2'] }}>
            {VISIBILITY_OPTIONS.map((opt) => {
              const selected = value === opt.value;
              const I = opt.IconComp;
              return (
                <PressableScale
                  key={opt.value}
                  onPress={() => handleSelect(opt.value)}
                  scaleValue={0.98}
                  accessibilityRole="radio"
                  accessibilityLabel={`${opt.label}: ${opt.desc}`}
                  accessibilityState={{ selected }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SP['3'],
                    paddingVertical: SP['3'],
                    paddingHorizontal: SP['4'],
                    borderRadius: R.lg,
                    backgroundColor: selected ? C.accentSoft : C.bg3,
                    borderWidth: 1.5,
                    borderColor: selected ? C.accent : 'transparent',
                  }}
                >
                  {/* leading アイコンタイル */}
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: R.md,
                      backgroundColor: selected ? C.accentBg : C.bg2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <I
                      size={20}
                      color={selected ? C.accentLight : C.text2}
                      strokeWidth={2.2}
                    />
                  </View>

                  {/* タイトル + 説明 */}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={[T.bodyB, { color: selected ? C.accentLight : C.text }]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                    <Text style={[T.small, { color: C.text3 }]} numberOfLines={1}>
                      {opt.desc}
                    </Text>
                  </View>

                  {/* trailing check (選択時のみ) */}
                  {selected && <Icon.check size={22} color={C.accent} strokeWidth={2.4} />}
                </PressableScale>
              );
            })}
          </View>
        </Animated.View>
        </SheetSwipeDown>
      </Animated.View>
    </Modal>
  );
}
