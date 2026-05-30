// ============================================================
// CommunityBigCard — ディスカバリーリストの「大きいカード」1 件分
// ------------------------------------------------------------
// 全幅・縦積みカード。アイコン + 名称 + メトリクス(メンバー/投稿) +
// 説明文 + 参加ボタンを表示する純粋な presentational component。
// - BODY タップ → onPress(community) (詳細を開く)
// - 参加ボタン → onJoin(community) (参加 / リクエスト / 遷移は親が決める)
// 参加ボタンは BODY とは別の PressableScale (ネストさせない)。
// ============================================================
import React from 'react';
import { View, Text } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useColors } from '../../hooks/useColors';
import { SP, R, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { hap } from '../../design/haptics';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { squareThumbedUrl } from '../../lib/utils/imageUrl';
import { formatCountJa } from '../../lib/format/communityMetrics';
import { type Community } from '../../lib/api/communities';

export interface CommunityBigCardProps {
  community: Community;
  isMember: boolean;
  joining?: boolean; // optimistic join in-flight
  onPress: (community: Community) => void; // open detail
  onJoin: (community: Community) => void; // join / request / navigate (parent decides)
}

export function CommunityBigCard(props: CommunityBigCardProps) {
  const { community, isMember, joining, onPress, onJoin } = props;
  const C = useColors();

  const isOpen = community.visibility === 'open';

  // 参加ボタンの 3 状態 (背景 / 枠 / 文字色 / ラベル / 左アイコン) を一括算出
  const joinState = isMember
    ? {
        bg: 'transparent',
        borderWidth: 1,
        borderColor: C.border2,
        color: C.text2,
        label: '参加済み',
        leftIcon: <Icon.check size={14} color={C.text2} />,
      }
    : isOpen
      ? {
          bg: C.accent,
          borderWidth: 0,
          borderColor: 'transparent',
          color: '#fff',
          label: '参加',
          leftIcon: null,
        }
      : {
          bg: C.amberBg,
          borderWidth: 1,
          borderColor: C.amber,
          color: C.amber,
          label: 'リクエスト',
          leftIcon: <Icon.lock size={12} color={C.amber} />,
        };

  const joinA11y = isMember
    ? `参加済み: ${community.name}`
    : isOpen
      ? `コミュニティに参加: ${community.name}`
      : `参加をリクエスト: ${community.name}`;

  return (
    <View
      style={[
        {
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          padding: SP['4'],
        },
        SHADOW.card,
      ]}
    >
      {/* BODY — タップで詳細を開く */}
      <PressableScale
        haptic="tap"
        onPress={() => {
          hap.tap();
          onPress(community);
        }}
        accessibilityLabel={`コミュニティを開く: ${community.name}`}
      >
        {/* Top row: アイコン + 右カラム */}
        <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
          {/* 56x56 円アイコン */}
          <View style={{ width: 56, height: 56, borderRadius: 28, overflow: 'hidden' }}>
            {community.icon_url ? (
              <ExpoImage
                source={{ uri: squareThumbedUrl(community.icon_url, 240) }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={120}
              />
            ) : (
              <View
                style={{
                  width: '100%',
                  height: '100%',
                  backgroundColor: community.icon_color,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 26 }}>{community.icon_emoji}</Text>
              </View>
            )}
          </View>

          {/* 右カラム: 名称 + メトリクス */}
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* 名称行 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text
                numberOfLines={1}
                style={[T.bodyM, { fontWeight: '700', color: C.text, flexShrink: 1 }]}
              >
                {community.name}
              </Text>
              {community.is_official ? <Icon.award size={14} color={C.accent} /> : null}
              {community.visibility !== 'open' ? (
                <Icon.lock size={12} color={C.text3} />
              ) : null}
            </View>

            {/* メトリクス行: メンバー / 投稿 の 2 ピル */}
            <View style={{ flexDirection: 'row', gap: SP['2'], marginTop: 4 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: C.bg3,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: R.full,
                }}
              >
                <Icon.friends size={10} color={C.text3} />
                <Text style={[T.caption, { color: C.text2 }]}>
                  {formatCountJa(community.member_count)}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: C.bg3,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: R.full,
                }}
              >
                <Icon.bbs size={10} color={C.text3} />
                <Text style={[T.caption, { color: C.text2 }]}>
                  {formatCountJa(community.post_count)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* 説明文 (description がある時のみ) */}
        {community.description ? (
          <Text
            numberOfLines={2}
            style={[T.small, { color: C.text2, marginTop: SP['2'], lineHeight: 18 }]}
          >
            {community.description}
          </Text>
        ) : null}
      </PressableScale>

      {/* 参加ボタン — BODY の sibling (ネストしない) */}
      <PressableScale
        haptic="select"
        disabled={joining}
        onPress={() => {
          hap.select();
          onJoin(community);
        }}
        accessibilityLabel={joinA11y}
        style={{ marginTop: SP['3'], opacity: joining ? 0.6 : 1 }}
      >
        <View
          style={{
            height: 36,
            borderRadius: R.full,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 6,
            backgroundColor: joinState.bg,
            borderWidth: joinState.borderWidth,
            borderColor: joinState.borderColor,
          }}
        >
          {joinState.leftIcon}
          <Text style={[T.bodyM, { fontWeight: '700', color: joinState.color }]}>
            {joining ? '…' : joinState.label}
          </Text>
        </View>
      </PressableScale>
    </View>
  );
}
