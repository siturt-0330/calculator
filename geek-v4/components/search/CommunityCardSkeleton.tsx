// ============================================================
// CommunityCardSkeleton — CommunityBigCard 読込中プレースホルダ
// ------------------------------------------------------------
// フルワイドの積み上げ型コミュカードと同じフットプリントを再現し、
// リスト読込中に表示する。RN 組み込み Animated で淡く脈動させる。
// ============================================================

import React, { useEffect, useRef } from 'react';
import { View, Animated } from 'react-native';
import { useColors } from '../../hooks/useColors';
import { SP, R } from '../../design/tokens';

export function CommunityCardSkeleton() {
  const C = useColors();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View
      style={{
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        padding: SP['4'],
      }}
    >
      <Animated.View style={{ opacity: pulse }}>
        {/* 上段: アイコン + 名前/メトリクス */}
        <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
          <View
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.bg3 }}
          />
          <View style={{ flex: 1 }}>
            <View
              style={{ height: 14, width: '60%', borderRadius: R.full, backgroundColor: C.bg3 }}
            />
            <View
              style={{
                height: 12,
                width: '40%',
                marginTop: 8,
                borderRadius: 6,
                backgroundColor: C.bg3,
              }}
            />
          </View>
        </View>

        {/* 説明文 2 行 */}
        <View
          style={{
            height: 12,
            width: '90%',
            marginTop: SP['3'],
            borderRadius: 6,
            backgroundColor: C.bg3,
          }}
        />
        <View
          style={{
            height: 12,
            width: '70%',
            marginTop: 6,
            borderRadius: 6,
            backgroundColor: C.bg3,
          }}
        />

        {/* ボタン */}
        <View
          style={{
            height: 36,
            width: '100%',
            marginTop: SP['3'],
            borderRadius: R.full,
            backgroundColor: C.bg3,
          }}
        />
      </Animated.View>
    </View>
  );
}

export function CommunityCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: SP['3'] }}>
      {Array.from({ length: count }).map((_, i) => (
        <CommunityCardSkeleton key={i} />
      ))}
    </View>
  );
}
