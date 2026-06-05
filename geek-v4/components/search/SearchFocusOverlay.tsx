// =============================================================================
// SearchFocusOverlay — 検索入力フォーカス時のオーバーレイ (X / Instagram 流)
// -----------------------------------------------------------------------------
// 検索タブ本体 UI は変えず、検索バーをタップ(focus)した瞬間に本文を覆う
// オーバーレイだけを世界一美しく作り替える。2 状態:
//
//   (A) 入力が空        → 「最近」: 最近見たコミュニティの横アバター列
//                          + 最近の検索ワード一覧 (履歴なしは「いまのトレンド」)
//   (B) 入力あり(typing) → 「候補」: 「<query>」を検索 + クエリ候補
//                          + タグ候補(#) + コミュニティ候補(アバター行)
//
// 設計上の事実 (subsystem 調査済):
//   - GEEK は匿名 SNS。公開ユーザー検索は存在しない → X/IG の「people」は
//     アイコンを持つ「コミュニティ」と「タグ」に対応づける。
//   - 最近見たコミュニティは recentCommunitiesStore に id/name/icon_*/member_count
//     入りで永続(hydrate 同期)。アバター列にそのまま流せる。
//   - クエリ候補は suggestQueries() (履歴 prefix + typo)、タグ候補は
//     useTagSearchV3().completions() (Trie 即時)、コミュニティは searchCommunities()。
//   - すべてクライアント既存ソース。新規バックエンド不要。
//
// 統合の作法 (親 search.tsx 側の約束を踏襲):
//   - 親が inputFocused / focusProgress / commit / cancelBlurTimer を所有。
//   - 各行は onPressIn={cancelBlurTimer} で「onBlur が onPress を食う」競合を回避。
//   - 親はヘッダ実測高 topOffset を渡し、本コンポーネントは絶対配置でその下を覆う。
//   - web は backdrop-blur が無いので透過に頼らず C.bg 不透明面で覆う。
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';

import { CommunityIcon } from '../ui/CommunityIcon';
import { PressableScale } from '../ui/PressableScale';
import { HighlightedText } from '../ui/HighlightedText';
import { SkeletonRow } from '../ui/SkeletonRow';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { EASE_OUT } from '../../design/motion';
import { withApiTimeout } from '../../lib/withApiTimeout';
import { useSearchHistory } from '../../hooks/useSearchHistory';
import { useTrendingTopics } from '../../hooks/useSearchV2';
import { useTagSearchV3 } from '../../hooks/useTagSearchV3';
import {
  useRecentCommunitiesStore,
  type RecentCommunity,
} from '../../stores/recentCommunitiesStore';
import { suggestQueries, type SuggestionV2 } from '../../lib/search/autocomplete';
import { searchCommunities, type CommunityHit } from '../../lib/api/communities';

// コミュニティ候補 fetch の debounce (typing 連打での無駄 fetch を抑える)
const SUGGEST_DEBOUNCE_MS = 180;

export interface SearchFocusOverlayProps {
  /** 生の入力値 (rawQuery)。空 → 「最近」、非空 → 「候補」。 */
  query: string;
  /** ヘッダ(検索バー)の実測高。オーバーレイはこの下を覆う。 */
  topOffset: number;
  /** safe-area 下端。リスト末尾の余白に使う。 */
  bottomInset: number;
  /** クエリを確定して検索実行 (親 commit)。履歴に積む + キーボードを閉じる。 */
  onSearchExact: (q: string) => void;
  /** 候補を入力欄へ流し込む(検索はしない。フォーカスは保つ)。 */
  onFillQuery: (q: string) => void;
  /** コミュニティを開く (→ /community/[id])。 */
  onOpenCommunity: (id: string) => void;
  /** タグを開く (→ /tag/[name])。 */
  onOpenTag: (name: string) => void;
  /** 入力 onBlur の遅延クローズを各行 onPressIn でキャンセルする。 */
  cancelBlurTimer: () => void;
}

// =============================================================================
// SearchFocusOverlay
// =============================================================================
export function SearchFocusOverlay({
  query,
  topOffset,
  bottomInset,
  onSearchExact,
  onFillQuery,
  onOpenCommunity,
  onOpenTag,
  cancelBlurTimer,
}: SearchFocusOverlayProps) {
  const trimmed = query.trim();
  const typing = trimmed.length > 0;

  // ----- 出現アニメ (opacity + 軽い slide-up)。mount 時に 0→1。 -----
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 200, easing: EASE_OUT });
  }, [enter]);
  const aEnter = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: interpolate(enter.value, [0, 1], [10, 0]) }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: topOffset,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: C.bg,
          zIndex: 9,
        },
        aEnter,
      ]}
    >
      <ScrollView
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: SP['3'], paddingBottom: bottomInset + SP['10'] }}
      >
        {typing ? (
          <TypingPanel
            query={trimmed}
            onSearchExact={onSearchExact}
            onFillQuery={onFillQuery}
            onOpenCommunity={onOpenCommunity}
            onOpenTag={onOpenTag}
            cancelBlurTimer={cancelBlurTimer}
          />
        ) : (
          <RecentPanel
            onSearchExact={onSearchExact}
            onOpenCommunity={onOpenCommunity}
            cancelBlurTimer={cancelBlurTimer}
          />
        )}
      </ScrollView>
    </Animated.View>
  );
}

// =============================================================================
// 共通: セクションラベル (小キャップス + 任意の右アクション)
// =============================================================================
function SectionLabel({
  icon: I,
  text,
  action,
}: {
  icon?: (typeof Icon)['clock'];
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: SP['5'],
        marginBottom: SP['2'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {I ? <I size={13} color={C.text3} strokeWidth={2.2} /> : null}
        <Text style={[T.captionM, { color: C.text3, letterSpacing: 0.6 }]}>{text}</Text>
      </View>
      {action ?? null}
    </View>
  );
}

// =============================================================================
// (A) RecentPanel — 入力が空のとき
// =============================================================================
function RecentPanel({
  onSearchExact,
  onOpenCommunity,
  cancelBlurTimer,
}: {
  onSearchExact: (q: string) => void;
  onOpenCommunity: (id: string) => void;
  cancelBlurTimer: () => void;
}) {
  const recents = useRecentCommunitiesStore((s) => s.items);
  const hydrate = useRecentCommunitiesStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const { history, removeQuery, clearAll } = useSearchHistory(12);
  const { data: trending = [] } = useTrendingTopics(24, 12);

  const hasRecents = recents.length > 0;
  const hasHistory = history.length > 0;

  return (
    <View style={{ gap: SP['6'] }}>
      {/* 最近見たコミュニティ — 横アバター列 (X の「最近の検索」アカウント行に相当) */}
      {hasRecents ? (
        <View>
          <SectionLabel icon={Icon.clock} text="最近見たコミュニティ" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{ gap: SP['4'], paddingHorizontal: SP['5'] }}
          >
            {recents.map((c) => (
              <RecentCommunityChip
                key={c.id}
                community={c}
                onPress={() => onOpenCommunity(c.id)}
                cancelBlurTimer={cancelBlurTimer}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 最近の検索ワード */}
      {hasHistory ? (
        <View>
          <SectionLabel
            text="最近の検索"
            action={
              <PressableScale
                onPressIn={cancelBlurTimer}
                onPress={clearAll}
                haptic="warn"
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="検索履歴をすべて消去"
              >
                <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
                  すべて消去
                </Text>
              </PressableScale>
            }
          />
          <View>
            {history.map((h) => (
              <RecentTermRow
                key={h}
                term={h}
                onPress={() => onSearchExact(h)}
                onRemove={() => removeQuery(h)}
                cancelBlurTimer={cancelBlurTimer}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* 履歴も最近コミュも無いとき: トレンドで埋める (空白の気まずさを避ける) */}
      {!hasRecents && !hasHistory && trending.length > 0 ? (
        <View>
          <SectionLabel icon={Icon.trendingUp} text="いまのトレンド" />
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: SP['2'],
              paddingHorizontal: SP['5'],
            }}
          >
            {trending.map((t) => (
              <TrendingPill
                key={t.topic}
                topic={t.topic}
                count={t.post_count}
                onPress={() => onSearchExact(t.topic.replace(/^#/, ''))}
                cancelBlurTimer={cancelBlurTimer}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* 完全に空 (履歴・最近・トレンド全部無し) のとき */}
      {!hasRecents && !hasHistory && trending.length === 0 ? (
        <View
          style={{
            alignItems: 'center',
            paddingTop: SP['16'],
            paddingHorizontal: SP['8'],
            gap: SP['3'],
          }}
        >
          <Icon.search size={28} color={C.text4} strokeWidth={2} />
          <Text style={[T.small, { color: C.text3, textAlign: 'center', lineHeight: 20 }]}>
            作品・コミュニティ・タグを検索して{'\n'}好きを見つけよう
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// 最近見たコミュニティ 1 件 (縦: アバター56 + 名前)
function RecentCommunityChip({
  community,
  onPress,
  cancelBlurTimer,
}: {
  community: RecentCommunity;
  onPress: () => void;
  cancelBlurTimer: () => void;
}) {
  return (
    <PressableScale
      onPressIn={cancelBlurTimer}
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={`${community.name} を開く`}
      style={{ width: 68, alignItems: 'center', gap: 6 }}
    >
      <CommunityIcon
        size={56}
        iconUrl={community.icon_url}
        iconEmoji={community.icon_emoji}
        iconColor={community.icon_color}
        name={community.name}
        ring
      />
      <Text
        numberOfLines={1}
        style={[T.caption, { color: C.text2, maxWidth: 64, textAlign: 'center' }]}
      >
        {community.name}
      </Text>
    </PressableScale>
  );
}

// 最近の検索ワード 1 行 (clock + 語 + ×)
function RecentTermRow({
  term,
  onPress,
  onRemove,
  cancelBlurTimer,
}: {
  term: string;
  onPress: () => void;
  onRemove: () => void;
  cancelBlurTimer: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <PressableScale
        onPressIn={cancelBlurTimer}
        onPress={onPress}
        haptic="select"
        accessibilityRole="button"
        accessibilityLabel={`${term} で検索`}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          paddingHorizontal: SP['5'],
          paddingVertical: SP['3'],
        }}
      >
        <Icon.clock size={16} color={C.text3} strokeWidth={2} />
        <Text style={[T.body, { color: C.text, flex: 1 }]} numberOfLines={1}>
          {term}
        </Text>
      </PressableScale>
      <PressableScale
        onPressIn={cancelBlurTimer}
        onPress={onRemove}
        haptic="warn"
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${term} を履歴から削除`}
        style={{ paddingHorizontal: SP['4'], paddingVertical: SP['3'] }}
      >
        <Icon.close size={15} color={C.text4} strokeWidth={2.2} />
      </PressableScale>
    </View>
  );
}

// トレンド pill (#topic +count)
function TrendingPill({
  topic,
  count,
  onPress,
  cancelBlurTimer,
}: {
  topic: string;
  count: number;
  onPress: () => void;
  cancelBlurTimer: () => void;
}) {
  const label = topic.startsWith('#') ? topic : `#${topic}`;
  return (
    <PressableScale
      onPressIn={cancelBlurTimer}
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={`${label} で検索`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: SP['3'],
        paddingVertical: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>{label}</Text>
      {count > 0 ? (
        <Text style={{ fontSize: 10, color: C.text3, fontWeight: '700' }}>+{count}</Text>
      ) : null}
    </PressableScale>
  );
}

// =============================================================================
// (B) TypingPanel — 入力ありのとき (候補)
// -----------------------------------------------------------------------------
// 重い tag エンジン(useTagSearchV3)とコミュニティ fetch はこの子に閉じ込め、
// 「最近」状態では mount しない (= フォーカスしただけで 500 タグ取得を走らせない)。
// =============================================================================
function TypingPanel({
  query,
  onSearchExact,
  onFillQuery,
  onOpenCommunity,
  onOpenTag,
  cancelBlurTimer,
}: {
  query: string;
  onSearchExact: (q: string) => void;
  onFillQuery: (q: string) => void;
  onOpenCommunity: (id: string) => void;
  onOpenTag: (name: string) => void;
  cancelBlurTimer: () => void;
}) {
  const terms = useMemo(() => [query], [query]);

  // クエリ候補 (履歴 prefix + typo)。同一クエリ自身は除く。即時(同期)。
  const suggestions = useMemo<SuggestionV2[]>(() => {
    const list = suggestQueries(query, {}, 6);
    const lower = query.toLowerCase();
    return list.filter((s) => s.text.trim().toLowerCase() !== lower);
  }, [query]);

  // タグ候補 (Trie prefix、即時)。エンジンは module 共有メモなので mount は安い。
  const tagEngine = useTagSearchV3();
  const tags = useMemo(() => tagEngine.completions(query, 8), [tagEngine, query]);

  // コミュニティ候補 (network)。debounce してから fetch。
  const [dq, setDq] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDq(query), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);
  const communitiesQ = useQuery<CommunityHit[]>({
    queryKey: ['search-suggest-communities', dq],
    queryFn: () =>
      withApiTimeout(searchCommunities({ query: dq, limit: 6 }), 'communities.suggest', 8000),
    enabled: dq.trim().length > 0,
    staleTime: 60_000,
    retry: 1,
  });
  const communities = communitiesQ.data ?? [];
  const communitiesLoading = communitiesQ.isLoading && dq.trim().length > 0;

  return (
    <View style={{ gap: SP['5'] }}>
      {/* 「<query>」を検索 — 主導線 */}
      <PressableScale
        onPressIn={cancelBlurTimer}
        onPress={() => onSearchExact(query)}
        haptic="select"
        accessibilityRole="button"
        accessibilityLabel={`${query} を検索`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          paddingHorizontal: SP['5'],
          paddingVertical: SP['3'],
        }}
      >
        <View style={{ width: 28, alignItems: 'center' }}>
          <Icon.search size={18} color={C.accent} strokeWidth={2.4} />
        </View>
        <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>
          <Text style={{ color: C.text, fontWeight: '700' }}>{query}</Text>
          <Text style={{ color: C.text3 }}>{' を検索'}</Text>
        </Text>
        <Icon.chevronR size={16} color={C.text4} strokeWidth={2.2} />
      </PressableScale>

      {/* クエリ候補 */}
      {suggestions.length > 0 ? (
        <View>
          {suggestions.map((s) => (
            <SuggestionRow
              key={`${s.source}:${s.text}`}
              suggestion={s}
              terms={terms}
              onPress={() => onSearchExact(s.text)}
              onFill={() => onFillQuery(s.text)}
              cancelBlurTimer={cancelBlurTimer}
            />
          ))}
        </View>
      ) : null}

      {/* タグ候補 (#) — 横スクロール pill */}
      {tags.length > 0 ? (
        <View>
          <SectionLabel icon={Icon.hash} text="タグ" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{ gap: SP['2'], paddingHorizontal: SP['5'] }}
          >
            {tags.map((name) => (
              <SuggestTagPill
                key={name}
                name={name}
                onPress={() => onOpenTag(name)}
                cancelBlurTimer={cancelBlurTimer}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* コミュニティ候補 (アバター行 = X/IG の「アカウント」相当) */}
      {communitiesLoading || communities.length > 0 ? (
        <View>
          <SectionLabel icon={Icon.community} text="コミュニティ" />
          {communitiesLoading && communities.length === 0 ? (
            <View style={{ paddingHorizontal: SP['5'] }}>
              <SkeletonRow kind="list-item" count={3} />
            </View>
          ) : (
            communities.map((c) => (
              <CommunityRow
                key={c.id}
                community={c}
                terms={terms}
                onPress={() => onOpenCommunity(c.id)}
                cancelBlurTimer={cancelBlurTimer}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

// クエリ候補 1 行 (source アイコン + ハイライト語 + ↖流し込み)
function SuggestionRow({
  suggestion,
  terms,
  onPress,
  onFill,
  cancelBlurTimer,
}: {
  suggestion: SuggestionV2;
  terms: string[];
  onPress: () => void;
  onFill: () => void;
  cancelBlurTimer: () => void;
}) {
  const I =
    suggestion.source === 'history'
      ? Icon.clock
      : suggestion.source === 'tag'
        ? Icon.hash
        : Icon.sparkles;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <PressableScale
        onPressIn={cancelBlurTimer}
        onPress={onPress}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel={`${suggestion.text} で検索`}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          paddingLeft: SP['5'],
          paddingRight: SP['2'],
          paddingVertical: SP['3'],
        }}
      >
        <View style={{ width: 28, alignItems: 'center' }}>
          <I size={16} color={C.text3} strokeWidth={2} />
        </View>
        <HighlightedText
          text={suggestion.text}
          terms={terms}
          numberOfLines={1}
          style={[T.body, { color: C.text, flex: 1 }]}
        />
      </PressableScale>
      <PressableScale
        onPressIn={cancelBlurTimer}
        onPress={onFill}
        haptic="tap"
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${suggestion.text} を入力欄へ`}
        style={{ paddingHorizontal: SP['4'], paddingVertical: SP['3'] }}
      >
        <Icon.arrowUL size={16} color={C.text3} strokeWidth={2} />
      </PressableScale>
    </View>
  );
}

// タグ候補 pill (#name)
function SuggestTagPill({
  name,
  onPress,
  cancelBlurTimer,
}: {
  name: string;
  onPress: () => void;
  cancelBlurTimer: () => void;
}) {
  return (
    <PressableScale
      onPressIn={cancelBlurTimer}
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={`#${name} を開く`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: SP['3'],
        paddingVertical: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Icon.hash size={12} color={C.accentLight} strokeWidth={2.4} />
      <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
        {name}
      </Text>
    </PressableScale>
  );
}

// コミュニティ候補 1 行 (アバター44 + 名前 + メンバー数 + 公式バッジ)
function CommunityRow({
  community,
  terms,
  onPress,
  cancelBlurTimer,
}: {
  community: CommunityHit;
  terms: string[];
  onPress: () => void;
  cancelBlurTimer: () => void;
}) {
  return (
    <PressableScale
      onPressIn={cancelBlurTimer}
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={`${community.name} を開く`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingHorizontal: SP['5'],
        paddingVertical: SP['2'],
      }}
    >
      <CommunityIcon
        size={44}
        iconUrl={community.icon_url}
        iconEmoji={community.icon_emoji}
        iconColor={community.icon_color}
        name={community.name}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <HighlightedText
            text={community.name}
            terms={terms}
            numberOfLines={1}
            style={[T.bodyM, { color: C.text, flexShrink: 1 }]}
          />
          {community.is_official ? (
            <Icon.check size={14} color={C.accent} strokeWidth={2.4} />
          ) : null}
        </View>
        <Text style={[T.small, { color: C.text3 }]} numberOfLines={1}>
          {community.member_count.toLocaleString('ja-JP')}人のメンバー
        </Text>
      </View>
      <Icon.chevronR size={16} color={C.text4} strokeWidth={2.2} />
    </PressableScale>
  );
}
