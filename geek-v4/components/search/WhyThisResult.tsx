// ============================================================
// components/search/WhyThisResult.tsx
// ------------------------------------------------------------
// 「この結果について」Bottom Sheet。検索結果の 1 投稿について、
// なぜそれが表示されたかの ResultFactor[] を server から取得して表示する。
//
// 設計判断:
//   - @gorhom/bottom-sheet ではなく Modal + Reanimated 3 で実装。
//     - 親 component が visible state を保持するシンプルな pattern を維持
//     - ref 管理 / parent から open/close する複雑さを避ける
//     - 既存の ConfirmDialog と同じ Modal + Animated 構成 (馴染む)
//   - Reanimated 3 (FadeIn / SlideInDown) を使い、Animated は使わない
//   - visible が true になった時に factors を fetch (簡潔)
//   - factor.weight (0..1) を horizontal bar の幅に
//   - 下部に「パーソナライズ設定を変更」link → /settings/search-preferences
// ============================================================

import { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
import {
  getResultExplanation,
  type ResultFactor,
} from '../../lib/api/searchPreferences';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

export type WhyThisResultProps = {
  postId: string;
  query: string;
  visible: boolean;
  onClose: () => void;
};

export function WhyThisResult({ postId, query, visible, onClose }: WhyThisResultProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [factors, setFactors] = useState<ResultFactor[] | null>(null);
  const [loading, setLoading] = useState(false);

  // visible が true になったタイミングで毎回 fetch する。
  // (post / query 切り替えに追従するため + cache に依存しない簡潔さ)
  useEffect(() => {
    let cancelled = false;
    if (!visible) {
      // close した時に factors を即クリアすると、次回 open 時に
      // 「前の結果のチラ見え」が無く綺麗
      setFactors(null);
      return;
    }
    setLoading(true);
    setFactors(null);
    (async () => {
      const result = await getResultExplanation(postId, query);
      if (cancelled) return;
      setFactors(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, postId, query]);

  const goToSettings = () => {
    onClose();
    // close アニメと干渉しないよう微小に遅延
    setTimeout(() => {
      router.push('/settings/search-preferences' as never);
    }, 80);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(160)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          justifyContent: 'flex-end',
        }}
      >
        {/* tap-to-dismiss backdrop */}
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
        />

        <Animated.View
          entering={SlideInDown.duration(260)}
          exiting={SlideOutDown.duration(200)}
          style={{
            backgroundColor: C.bg2,
            borderTopLeftRadius: R.xl,
            borderTopRightRadius: R.xl,
            paddingBottom: insets.bottom + SP['4'],
            maxHeight: '80%',
            borderTopWidth: 1,
            borderTopColor: C.border,
          }}
        >
          {/* drag indicator */}
          <View style={{ alignItems: 'center', paddingTop: SP['2'] }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: C.text4,
              }}
            />
          </View>

          {/* header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['5'],
              paddingTop: SP['3'],
              paddingBottom: SP['3'],
            }}
          >
            <Icon.info size={20} color={C.accent} strokeWidth={2.2} />
            <Text style={[T.h4, { color: C.text, flex: 1 }]}>
              この結果について
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: C.bg3,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.close size={18} color={C.text2} strokeWidth={2.2} />
            </Pressable>
          </View>

          {query.length > 0 && (
            <Text
              style={[
                T.caption,
                {
                  color: C.text3,
                  paddingHorizontal: SP['5'],
                  paddingBottom: SP['3'],
                },
              ]}
            >
              検索クエリ「{query}」に対するこの結果のランキング要因です
            </Text>
          )}

          {/* body */}
          <ScrollView
            style={{ maxHeight: 420 }}
            contentContainerStyle={{
              paddingHorizontal: SP['5'],
              paddingBottom: SP['4'],
              gap: SP['3'],
            }}
            showsVerticalScrollIndicator={false}
          >
            {loading && (
              <View
                style={{
                  paddingVertical: SP['6'],
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: SP['2'],
                }}
              >
                <ActivityIndicator color={C.accent} />
                <Text style={[T.caption, { color: C.text3 }]}>
                  ランキング要因を取得しています...
                </Text>
              </View>
            )}

            {!loading && factors !== null && factors.length === 0 && (
              <View
                style={{
                  paddingVertical: SP['6'],
                  alignItems: 'center',
                  gap: SP['2'],
                }}
              >
                <Icon.info size={28} color={C.text3} strokeWidth={2} />
                <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
                  この結果のランキング要因は取得できませんでした
                </Text>
              </View>
            )}

            {!loading &&
              factors !== null &&
              factors.length > 0 &&
              factors.map((f, i) => <FactorRow key={`${f.factor}-${i}`} factor={f} />)}
          </ScrollView>

          {/* footer link */}
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: C.border,
              paddingHorizontal: SP['5'],
              paddingTop: SP['3'],
            }}
          >
            <PressableScale
              onPress={goToSettings}
              haptic="tap"
              accessibilityRole="link"
              accessibilityLabel="パーソナライズ設定を変更"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: SP['2'],
                paddingVertical: SP['3'],
              }}
            >
              <Icon.settings size={16} color={C.accentLight} strokeWidth={2.2} />
              <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>
                パーソナライズ設定を変更
              </Text>
              <Icon.chevronR size={14} color={C.accentLight} strokeWidth={2.2} />
            </PressableScale>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ============================================================
// FactorRow — 1 要因 (name + bar + description)
// ============================================================
function FactorRow({ factor }: { factor: ResultFactor }) {
  // 0..1 を百分率 (0..100%) に。Reanimated は使わず純粋な width 表現で十分。
  const pct = Math.round(Math.max(0, Math.min(1, factor.weight)) * 100);

  return (
    <View
      style={{
        padding: SP['3'],
        backgroundColor: C.bg3,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Text style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}>
          {factor.factor}
        </Text>
        <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
          {pct}%
        </Text>
      </View>

      {/* weight bar */}
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: C.bg4,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: C.accent,
            borderRadius: 3,
          }}
        />
      </View>

      {factor.description.length > 0 && (
        <Text style={[T.caption, { color: C.text3 }]}>{factor.description}</Text>
      )}
    </View>
  );
}
