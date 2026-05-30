// =============================================================================
// SimilarCommunityNotice — 似た名前のコミュニティ警告(EDITORIAL「特集」言語 / 傍註)
// -----------------------------------------------------------------------------
// コミュニティ作成画面で名前入力中に「似た名前」を検索して注意喚起する presentational 部品。
// 設計言語: 黒地 + 1px hairline + 大型タイポ + accent を要所に集中(検索タブと統一)。
//   ・塗りつぶしカードにせず、上下 hairline(C.divider)+ 左に amber の細い縦バー(ledger
//     rule の amber 版)で「版面の脇に編集者が鉛筆で書き込む欄外註(marginalia)」として表現。
//   ・禁止ではなく注意なので red ではなく C.amber を一点だけ使う。
//   ・各行は PressableScale でタップ可能(プレビュー導線)。
// 状態:
//   ・checking && query.length>=2          → 「類似名を検索中…」(T.caption / C.text3)
//   ・communities.length>0                  → 囲み + N件見出し + 各行
//   ・communities 空 & !checking            → null(何も描かない)
// 全 props 注入の presentational(fetch/router/store 購読を持たない)。
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { C, SP, R, SIZE } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { TIMING_NORM } from '../../design/motion';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import type { Community } from '../../lib/api/communities';

interface SimilarCommunityNoticeProps {
  communities: Community[];
  checking: boolean;
  query: string;
  onPressCommunity: (id: string) => void;
}

export function SimilarCommunityNotice({
  communities,
  checking,
  query,
  onPressCommunity,
}: SimilarCommunityNoticeProps) {
  const reduce = useReducedMotion();

  // ── 検索中(まだ結果が無い): 静かな進行表示 ────────────────────────────────
  if (checking && communities.length === 0) {
    if (query.length < 2) return null;
    return (
      <Animated.View
        entering={FadeIn.duration(220)}
        style={styles.checkingRow}
      >
        <Text style={styles.checkingText}>類似名を検索中…</Text>
      </Animated.View>
    );
  }

  // ── 結果なし & 検索もしていない: 何も描かない ──────────────────────────────
  if (communities.length === 0) return null;

  // ── 似た名前の囲み(傍註) ────────────────────────────────────────────────
  // reduce-motion 時は移動を伴う FadeInDown を避け、純 FadeIn にする。
  return (
    <Animated.View
      entering={
        reduce ? FadeIn.duration(220) : FadeInDown.duration(220)
      }
      exiting={FadeOut.duration(120)}
      style={styles.frame}
    >
      {/* 左の amber 縦バー(編集者の鉛筆罫) */}
      <View style={styles.amberRule} pointerEvents="none" />

      {/* 本文 */}
      <View style={styles.body}>
        {/* 見出し */}
        <Text style={styles.headline}>
          似た名前のコミュニティが {communities.length} 件
        </Text>
        <Text style={styles.subline}>参加した方が早いかも</Text>

        {/* 各コミュニティ行 */}
        <View style={styles.list}>
          {communities.map((c) => (
            <CommunityRow key={c.id} community={c} onPress={onPressCommunity} />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

// =============================================================================
// 1行: 小円アイコン + 名前 + メンバー数 + chevronR
// =============================================================================
interface CommunityRowProps {
  community: Community;
  onPress: (id: string) => void;
}

function CommunityRow({ community, onPress }: CommunityRowProps) {
  const hasImage = !!community.icon_url;
  const memberCount = community.member_count ?? 0;

  return (
    <PressableScale
      onPress={() => onPress(community.id)}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={`${community.name} を見る`}
      style={styles.row}
    >
      {/* 小円アイコン */}
      <View style={styles.iconWrap}>
        {hasImage ? (
          <ExpoImage
            source={{ uri: community.icon_url ?? undefined }}
            contentFit="cover"
            transition={TIMING_NORM.duration}
            style={styles.iconImage}
            accessible={false}
          />
        ) : (
          <View
            style={[
              styles.iconEmoji,
              { backgroundColor: community.icon_color ?? C.bg3 },
            ]}
          >
            <Text style={styles.iconEmojiText}>{community.icon_emoji ?? '#'}</Text>
          </View>
        )}
      </View>

      {/* テキスト */}
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {community.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          メンバー {memberCount} 人
        </Text>
      </View>

      <Icon.chevronR size={SIZE.iconMd} color={C.text3} />
    </PressableScale>
  );
}

const ICON = 32;

const styles = StyleSheet.create({
  // 検索中
  checkingRow: {
    paddingHorizontal: SP[5],
    marginTop: SP[3],
  },
  checkingText: {
    ...T.caption,
    fontFamily: FONT.jp,
    color: C.text3,
  },

  // 囲み(上下 hairline + 左 amber 縦バー)
  frame: {
    marginTop: SP[3],
    marginHorizontal: SP[5],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.divider,
    flexDirection: 'row',
    paddingVertical: SP[3],
  },
  amberRule: {
    width: 2,
    alignSelf: 'stretch',
    backgroundColor: C.amber,
    opacity: 0.5,
    borderRadius: 1,
  },
  body: {
    flex: 1,
    marginLeft: SP[3],
  },
  headline: {
    ...T.smallM,
    fontFamily: FONT.jpM,
    color: C.amber,
  },
  subline: {
    ...T.caption,
    fontFamily: FONT.jp,
    color: C.text2,
    marginTop: SP[1],
  },

  // 行リスト
  list: {
    marginTop: SP[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    paddingVertical: SP[2],
  },
  iconWrap: {
    width: ICON,
    height: ICON,
  },
  iconImage: {
    width: ICON,
    height: ICON,
    borderRadius: R.full,
    backgroundColor: C.bg3,
  },
  iconEmoji: {
    width: ICON,
    height: ICON,
    borderRadius: R.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmojiText: {
    fontSize: 16,
    lineHeight: 20,
    textAlign: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    ...T.smallM,
    fontFamily: FONT.jpM,
    color: C.text,
  },
  rowMeta: {
    ...T.caption,
    fontFamily: FONT.jp,
    color: C.text3,
    marginTop: SP[1],
  },
});
