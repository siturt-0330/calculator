// =============================================================
// DraftsEmpty — 下書きの白紙状態（特集ことば／白紙の見開き）
// EditorialEmpty(components/search/EditorialEmpty.tsx) と質感を統一。
// 黒地 + 大型タイポ + 罫線、塗りなし・余白で語る。左揃え上寄せ。
// presentational のみ（onBrowse 任意・それ以外 props なし）。
// =============================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { C, SP } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';

export function DraftsEmpty({ onBrowse }: { onBrowse?: () => void }) {
  const reduce = useReducedMotion();

  return (
    <Animated.View
      entering={reduce ? undefined : FadeIn.duration(300)}
      style={styles.wrap}
    >
      <View style={styles.frame}>
        <Text style={styles.title}>下書きはありません</Text>
        <Text style={styles.body}>
          書きかけの投稿やコミュニティはここに自動保存されます。
        </Text>

        {onBrowse ? (
          <PressableScale
            onPress={onBrowse}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel="投稿してみる"
            style={styles.link}
          >
            <Icon.plus size={14} color={C.text2} />
            <Text style={styles.linkLabel}>投稿してみる</Text>
          </PressableScale>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: SP[10],
    paddingHorizontal: SP[5],
    alignItems: 'flex-start',
  },
  frame: {
    alignSelf: 'stretch',
  },
  title: {
    ...T.display,
    fontFamily: FONT.jpB,
    color: C.text,
  },
  body: {
    ...T.body,
    color: C.text3,
    marginTop: SP[3],
    maxWidth: 280,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
    marginTop: SP[5],
    paddingTop: SP[4],
    borderTopWidth: 1,
    borderTopColor: C.divider,
  },
  linkLabel: {
    ...T.smallM,
    color: C.text2,
  },
});
