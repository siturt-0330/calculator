// ============================================================
// CommunityTabBar — コミュニティ詳細画面の 5-tab bar
// ============================================================
// 5 等分配置 + sliding underline (Reanimated)。公式コミュは tabs が変わるので
// isOfficial flag を見て getTabsFor で配列を切替。
// TabKey / TABS 配列もここにまとめ、screen は import するだけにする。
// ============================================================
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { C } from '../../design/tokens';
import { T } from '../../design/typography';
import { SP } from '../../design/tokens';
import { SPRING_TIGHT } from '../../design/motion';

export type TabKey = 'feed' | 'threads' | 'spots' | 'events' | 'compose' | 'comments';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'feed',     label: 'ホーム' },
  { key: 'threads',  label: '掲示板' },
  { key: 'spots',    label: '聖地' },
  { key: 'events',   label: 'カレンダー' },
  { key: 'compose',  label: '投稿' },
];

// 公式コミュニティ用のタブセット
// - ホーム: 公式管理者のみ投稿可 (一般メンバーは閲覧のみ)
// - Q&A: 旧「掲示板」を置換 — NotebookLM 風の質疑応答
// - 聖地 / カレンダー: 同じ
// - コメント: 旧「投稿」を置換 — 一般ユーザーが唯一書き込める場
const OFFICIAL_TABS: { key: TabKey; label: string }[] = [
  { key: 'feed',     label: 'ホーム' },
  { key: 'threads',  label: 'Q&A' },
  { key: 'spots',    label: '聖地' },
  { key: 'events',   label: 'カレンダー' },
  { key: 'comments', label: 'コメント' },
];

export function getTabsFor(isOfficial: boolean) {
  return isOfficial ? OFFICIAL_TABS : TABS;
}

export function CommunityTabBar({
  activeTab,
  onChange,
  isOfficial = false,
}: {
  activeTab: TabKey;
  onChange: (k: TabKey) => void;
  isOfficial?: boolean;
}) {
  const tabs = getTabsFor(isOfficial);
  const [barW, setBarW] = useState(0);
  const segW = barW / tabs.length;
  const idx = tabs.findIndex((t) => t.key === activeTab);
  const x = useSharedValue(0);

  useEffect(() => {
    if (segW > 0) x.value = withSpring(idx * segW, SPRING_TIGHT);
  }, [idx, segW, x]);

  const underlineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value + segW * 0.2 }],
    width: segW * 0.6,
  }));

  return (
    <View
      onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: C.border,
        backgroundColor: C.bg,
        position: 'relative',
      }}
    >
      {tabs.map((t) => {
        const active = activeTab === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingTop: SP['3'],
              paddingBottom: SP['3'] + 3, // underline 分の余白
            }}
          >
            <Text
              style={[
                T.smallM,
                {
                  color: active ? C.text : C.text2,
                  fontWeight: active ? '700' : '600',
                },
              ]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
      {/* sliding underline — 全 tab に対する絶対配置で animate */}
      {segW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: 3,
              borderRadius: 1.5,
              backgroundColor: C.accent,
            },
            underlineStyle,
          ]}
        />
      )}
    </View>
  );
}
