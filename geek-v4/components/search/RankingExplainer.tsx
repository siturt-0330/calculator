// ============================================================
// components/search/RankingExplainer.tsx
// ------------------------------------------------------------
// Search v4 専用「この結果について」Bottom-Sheet 風 Modal。
//
// 既存の WhyThisResult.tsx (D2 agent 作成) は ResultFactor[] (weight 0..1) を
// 1 軸でリスト表示する旧 API 前提の simple 版。本 component は v4 で導入された
// `ResultExplanation` (factors[].contribution / category / query_intent /
// is_personalized) を使って「正/負/中立」の 3 群に分けた transparency UI を提供する。
//
// Geek の transparency feature として強調するもの:
//   1. なぜこの結果が出たか — factor ごとに正負の寄与を可視化
//   2. クエリ意図 — どう解釈されたかを開示
//   3. パーソナライズの ON/OFF — 個別最適化が効いているかを開示
//   4. 設定への動線 — 不本意なら即 off にできる
//
// 設計判断:
//   - @gorhom/bottom-sheet ではなく RN Modal + Reanimated 3 を使う
//     (WhyThisResult と同じ pattern を踏襲、依存を増やさない)
//   - Modal presentationStyle="formSheet" は iOS のみ有効。Android/Web は
//     transparent overlay に fallback して slide-up を Reanimated でやる
//   - bar の幅 animate は Reanimated 3 (useSharedValue + useAnimatedStyle +
//     withTiming 300ms)。useEffect で data 変化に追従
//   - useResultExplanation({ enabled: visible }) で modal を開いた時だけ fetch
//   - any 禁止。型 guard は lib/api/searchV4 側で完了済 (ResultExplanation 形)
//   - 絵文字は使わず lucide-react-native のアイコンを Icon 経由で利用
//   - dark / light どちらでも見えるよう useColors() を使う
// ============================================================

import { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useResultExplanation } from '../../hooks/useSearchV4';
import type { ResultExplanation } from '../../lib/api/searchV4';
import { useColors } from '../../hooks/useColors';
import { SP, R, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

// ----------------------------------------------------------------
// 型
// ----------------------------------------------------------------

type Props = {
  visible: boolean;
  onClose: () => void;
  postId: string;
  query: string;
  postTitle?: string;
};

type Factor = ResultExplanation['factors'][number];
type Category = Factor['category'];

// ----------------------------------------------------------------
// 定数
// ----------------------------------------------------------------

const BAR_HEIGHT = 8;
const BAR_ANIM_MS = 300;

// query_intent (server から来る english key) → 日本語ラベル mapping。
// 未知の intent は fallback として「一般的な質問」として表示する。
const INTENT_LABEL_JA: Record<string, string> = {
  informational: '情報を探している',
  navigational: '特定の場所/コンテンツを探している',
  transactional: 'アクションを起こしたい',
  commercial: '比較・検討している',
  general: '一般的な質問',
};

// signal key → 日本語の人間向け factor 名 mapping。
// description は server から日本語で来る前提なので、ここは「短い見出し」用途。
const FACTOR_LABEL_JA: Record<string, string> = {
  text_relevance: 'テキスト一致度',
  recency: '新しさ',
  eeat: '信頼性・専門性',
  usability: '読みやすさ',
  viewed_boost: '閲覧履歴の親和',
  history_boost: 'あなたの活動履歴',
  freshness: '鮮度',
  safety_negation: '安全性チェック',
  clickbait_negation: 'クリックベイト判定',
  diversity_penalty: '多様化補正',
};

// signal key → アイコン mapping。lucide-react-native のアイコンを Icon 経由で。
// 未知 key は info にフォールバック。
function pickIcon(key: string): typeof Icon.info {
  switch (key) {
    case 'text_relevance':
      return Icon.search;
    case 'recency':
    case 'freshness':
      return Icon.clock;
    case 'eeat':
      return Icon.shield;
    case 'usability':
      return Icon.check;
    case 'viewed_boost':
      return Icon.eye;
    case 'history_boost':
      return Icon.sparkles;
    case 'safety_negation':
      return Icon.shield;
    case 'clickbait_negation':
      return Icon.warn;
    case 'diversity_penalty':
      return Icon.flag;
    default:
      return Icon.info;
  }
}

// ----------------------------------------------------------------
// 本体
// ----------------------------------------------------------------

export function RankingExplainer({
  visible,
  onClose,
  postId,
  query,
  postTitle,
}: Props): React.ReactElement {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, isError } = useResultExplanation({
    post_id: postId,
    query,
    include_advanced: true,
    enabled: visible,
  });

  // contribution の絶対値の最大を求めて bar 幅の正規化に使う。
  // 0 fallback (data 未着 / factors=[]) は 1 にして division-by-zero を避ける。
  const maxAbsContribution = useMemo(() => {
    if (!data || data.factors.length === 0) return 1;
    let max = 0;
    for (const f of data.factors) {
      const abs = Math.abs(f.contribution);
      if (abs > max) max = abs;
    }
    return max > 0 ? max : 1;
  }, [data]);

  // category ごとに 3 群に分割。display 順は positive → negative → neutral。
  const groups = useMemo(() => {
    const positive: Factor[] = [];
    const negative: Factor[] = [];
    const neutral: Factor[] = [];
    if (!data) return { positive, negative, neutral };
    for (const f of data.factors) {
      if (f.category === 'positive') positive.push(f);
      else if (f.category === 'negative') negative.push(f);
      else neutral.push(f);
    }
    // 各群の中は |contribution| 降順 (重要なものを上に)
    const byImpact = (a: Factor, b: Factor) =>
      Math.abs(b.contribution) - Math.abs(a.contribution);
    positive.sort(byImpact);
    negative.sort(byImpact);
    neutral.sort(byImpact);
    return { positive, negative, neutral };
  }, [data]);

  const goToSettings = () => {
    onClose();
    // close アニメと navigation の競合を避けるため微小に遅延 (WhyThisResult と同じ pattern)
    setTimeout(() => {
      router.push('/settings/search-preferences' as never);
    }, 80);
  };

  const intentLabel = data
    ? INTENT_LABEL_JA[data.query_intent] ?? '一般的な質問'
    : null;

  // iOS の formSheet は本物の bottom sheet 風に見せるネイティブ動作なので利用。
  // 他 platform は transparent overlay + Reanimated slide でフォールバック。
  const useFormSheet = Platform.OS === 'ios';

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      transparent={!useFormSheet}
      animationType={useFormSheet ? 'slide' : 'none'}
      presentationStyle={useFormSheet ? 'formSheet' : undefined}
    >
      {/* iOS formSheet 時は OS が背景を出すので scrim 不要。それ以外は dim layer を被せる */}
      {!useFormSheet ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(160)}
          style={{
            flex: 1,
            backgroundColor: C.scrim,
            justifyContent: 'flex-end',
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="閉じる"
            onPress={onClose}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <Animated.View
            entering={SlideInDown.duration(260)}
            exiting={SlideOutDown.duration(200)}
            style={[
              sheetContainerStyle(C, insets.bottom),
              { maxHeight: '88%' },
            ]}
          >
            <SheetContents
              C={C}
              isLoading={isLoading}
              isError={isError}
              data={data}
              groups={groups}
              maxAbsContribution={maxAbsContribution}
              postTitle={postTitle}
              intentLabel={intentLabel}
              onClose={onClose}
              onSettings={goToSettings}
            />
          </Animated.View>
        </Animated.View>
      ) : (
        <View
          style={[
            sheetContainerStyle(C, insets.bottom),
            { flex: 1, marginTop: 0 },
          ]}
        >
          <SheetContents
            C={C}
            isLoading={isLoading}
            isError={isError}
            data={data}
            groups={groups}
            maxAbsContribution={maxAbsContribution}
            postTitle={postTitle}
            intentLabel={intentLabel}
            onClose={onClose}
            onSettings={goToSettings}
          />
        </View>
      )}
    </Modal>
  );
}

// ----------------------------------------------------------------
// SheetContents — handle + header + body + footer をまとめた本体
// ----------------------------------------------------------------

type SheetContentsProps = {
  C: ReturnType<typeof useColors>;
  isLoading: boolean;
  isError: boolean;
  data: ResultExplanation | undefined;
  groups: { positive: Factor[]; negative: Factor[]; neutral: Factor[] };
  maxAbsContribution: number;
  postTitle: string | undefined;
  intentLabel: string | null;
  onClose: () => void;
  onSettings: () => void;
};

function SheetContents({
  C,
  isLoading,
  isError,
  data,
  groups,
  maxAbsContribution,
  postTitle,
  intentLabel,
  onClose,
  onSettings,
}: SheetContentsProps): React.ReactElement {
  const empty =
    !isLoading &&
    !isError &&
    data !== undefined &&
    groups.positive.length === 0 &&
    groups.negative.length === 0 &&
    groups.neutral.length === 0;

  return (
    <>
      {/* drag indicator (handle bar) */}
      <View style={{ alignItems: 'center', paddingTop: SP['2'] }}>
        <View
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: C.text4,
          }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>

      {/* header — title + close */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: SP['2'],
          paddingHorizontal: SP['5'],
          paddingTop: SP['3'],
          paddingBottom: SP['2'],
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={[T.h3, { color: C.text, fontWeight: '600' }]}
            accessibilityRole="header"
          >
            この結果について
          </Text>
          {postTitle !== undefined && postTitle.trim().length > 0 ? (
            <Text
              style={[T.caption, { color: C.text3 }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {postTitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          hitSlop={12}
          style={{
            width: SIZE.iconLg + SP['1'],
            height: SIZE.iconLg + SP['1'],
            borderRadius: R.full,
            backgroundColor: C.bg3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.close size={18} color={C.text2} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* body */}
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{
          paddingHorizontal: SP['5'],
          paddingTop: SP['2'],
          paddingBottom: SP['4'],
          gap: SP['4'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* loading state — 3 件分の skeleton */}
        {isLoading ? <SkeletonGroup C={C} /> : null}

        {/* error state */}
        {!isLoading && isError ? (
          <View
            style={{
              paddingVertical: SP['6'],
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <Icon.warn size={28} color={C.text3} strokeWidth={2} />
            <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
              ランキング要因の取得に失敗しました
            </Text>
          </View>
        ) : null}

        {/* empty state */}
        {empty ? (
          <View
            style={{
              paddingVertical: SP['6'],
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <Icon.info size={28} color={C.text3} strokeWidth={2} />
            <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
              この結果のランキング要因は提供されていません
            </Text>
          </View>
        ) : null}

        {/* グループ表示 (positive → negative → neutral) */}
        {!isLoading && !isError && data !== undefined ? (
          <>
            <FactorGroup
              C={C}
              title="プラスに働いた要因"
              category="positive"
              factors={groups.positive}
              maxAbsContribution={maxAbsContribution}
            />
            <FactorGroup
              C={C}
              title="マイナスに働いた要因"
              category="negative"
              factors={groups.negative}
              maxAbsContribution={maxAbsContribution}
            />
            <FactorGroup
              C={C}
              title="参考にした要因"
              category="neutral"
              factors={groups.neutral}
              maxAbsContribution={maxAbsContribution}
            />
          </>
        ) : null}
      </ScrollView>

      {/* footer — intent / personalization 表示 + 設定遷移 */}
      {!isLoading && data !== undefined ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: C.border,
            paddingHorizontal: SP['5'],
            paddingTop: SP['3'],
            paddingBottom: SP['1'],
            gap: SP['2'],
          }}
        >
          {intentLabel !== null ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
              }}
            >
              <Icon.search size={14} color={C.text3} strokeWidth={2.2} />
              <Text
                style={[T.caption, { color: C.text2, flex: 1 }]}
                numberOfLines={2}
              >
                あなたのクエリは「{intentLabel}」として解釈されました
              </Text>
            </View>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <Icon.sparkles
              size={14}
              color={data.is_personalized ? C.accent : C.text3}
              strokeWidth={2.2}
            />
            <Text
              style={[T.caption, { color: C.text2, flex: 1 }]}
              numberOfLines={2}
            >
              あなた向けに最適化:{' '}
              <Text style={{ color: data.is_personalized ? C.accent : C.text3, fontWeight: '700' }}>
                {data.is_personalized ? 'ON' : 'OFF'}
              </Text>
            </Text>
          </View>

          <Pressable
            onPress={onSettings}
            accessibilityRole="link"
            accessibilityLabel="パーソナライズ設定を変更"
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: SP['1'],
              paddingVertical: SP['3'],
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icon.settings size={14} color={C.accentLight} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>
              パーソナライズ設定を変更
            </Text>
            <Icon.chevronR size={14} color={C.accentLight} strokeWidth={2.2} />
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------
// FactorGroup — 1 カテゴリ分の見出し + 行リスト
// ----------------------------------------------------------------

function FactorGroup({
  C,
  title,
  category,
  factors,
  maxAbsContribution,
}: {
  C: ReturnType<typeof useColors>;
  title: string;
  category: Category;
  factors: Factor[];
  maxAbsContribution: number;
}): React.ReactElement | null {
  if (factors.length === 0) return null;

  const headerColor =
    category === 'positive' ? C.green : category === 'negative' ? C.red : C.text2;

  return (
    <View style={{ gap: SP['2'] }}>
      <Text
        style={[T.captionM, { color: headerColor, fontWeight: '700' }]}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <View style={{ gap: SP['2'] }}>
        {factors.map((f) => (
          <FactorRow
            key={f.key}
            C={C}
            factor={f}
            maxAbsContribution={maxAbsContribution}
          />
        ))}
      </View>
    </View>
  );
}

// ----------------------------------------------------------------
// FactorRow — 1 要因。アイコン + ラベル + bar + 数値 + 説明
// ----------------------------------------------------------------

function FactorRow({
  C,
  factor,
  maxAbsContribution,
}: {
  C: ReturnType<typeof useColors>;
  factor: Factor;
  maxAbsContribution: number;
}): React.ReactElement {
  // bar の幅は |contribution| を正規化 (0..1)。color は category で決定。
  const ratio = Math.max(
    0,
    Math.min(1, Math.abs(factor.contribution) / maxAbsContribution),
  );

  // Reanimated 3: shared value を 0 から ratio へ withTiming で animate。
  // useEffect 経由で data が変わった時に再度 animate される。
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(ratio, {
      duration: BAR_ANIM_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [ratio, progress]);

  const animatedBarStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const barColor =
    factor.category === 'positive'
      ? C.green
      : factor.category === 'negative'
      ? C.red
      : C.text3;

  const trackColor =
    factor.category === 'positive'
      ? C.greenBg
      : factor.category === 'negative'
      ? C.redBg
      : C.bg4;

  const label = FACTOR_LABEL_JA[factor.key] ?? factor.key;
  const IconComp = pickIcon(factor.key);

  // 数値表示: +0.42 / -0.18 / 0.00 形式
  const contribStr = formatContribution(factor.contribution);
  const contribColor =
    factor.contribution > 0
      ? C.green
      : factor.contribution < 0
      ? C.red
      : C.text3;

  // a11y 用の単一読み上げ文。アイコン + ラベル + 寄与 + 説明をまとめて。
  const a11yLabel = `${label}、寄与 ${contribStr}${
    factor.description.length > 0 ? `、${factor.description}` : ''
  }`;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={a11yLabel}
      style={{
        padding: SP['3'],
        backgroundColor: C.bg3,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
      }}
    >
      {/* row: icon + label ... bar ... value */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <IconComp size={16} color={barColor} strokeWidth={2.2} />
        <Text
          style={[T.smallM, { color: C.text, flex: 1, fontWeight: '600' }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text
          style={[
            T.smallM,
            {
              color: contribColor,
              fontWeight: '700',
              minWidth: 56,
              textAlign: 'right',
            },
          ]}
        >
          {contribStr}
        </Text>
      </View>

      {/* bar */}
      <View
        style={{
          height: BAR_HEIGHT,
          borderRadius: BAR_HEIGHT / 2,
          backgroundColor: trackColor,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[
            {
              height: '100%',
              backgroundColor: barColor,
              borderRadius: BAR_HEIGHT / 2,
            },
            animatedBarStyle,
          ]}
        />
      </View>

      {/* description (server から日本語で来る) */}
      {factor.description.length > 0 ? (
        <Text style={[T.caption, { color: C.text3 }]}>{factor.description}</Text>
      ) : null}
    </View>
  );
}

// ----------------------------------------------------------------
// SkeletonGroup — loading 中の placeholder 3 件
// ----------------------------------------------------------------

function SkeletonGroup({ C }: { C: ReturnType<typeof useColors> }): React.ReactElement {
  // 3 件分の skeleton bar。subtle な pulsing を Reanimated で簡易に。
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    // ループ的に値を振らす — withTiming のチェーンで 0.5 ⇄ 1.0 を行き来。
    // requestAnimationFrame 的な無限 loop は使わず、初期 fade-in だけにとどめて
    // (静的でも OK、bundle/CPU 節約を優先)。
    pulse.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }));

  return (
    <Animated.View style={[{ gap: SP['3'] }, animatedStyle]}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            padding: SP['3'],
            backgroundColor: C.bg3,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: R.sm,
                backgroundColor: C.bg4,
              }}
            />
            <View
              style={{
                flex: 1,
                height: 12,
                borderRadius: R.sm,
                backgroundColor: C.bg4,
              }}
            />
            <View
              style={{
                width: 48,
                height: 12,
                borderRadius: R.sm,
                backgroundColor: C.bg4,
              }}
            />
          </View>
          <View
            style={{
              height: BAR_HEIGHT,
              borderRadius: BAR_HEIGHT / 2,
              backgroundColor: C.bg4,
            }}
          />
        </View>
      ))}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SP['2'],
          paddingVertical: SP['2'],
        }}
      >
        <ActivityIndicator color={C.accent} />
        <Text style={[T.caption, { color: C.text3 }]}>
          ランキング要因を取得中...
        </Text>
      </View>
    </Animated.View>
  );
}

// ----------------------------------------------------------------
// utils
// ----------------------------------------------------------------

/**
 * contribution を "+0.42" / "-0.18" / "0.00" 形式に。
 * Number.toFixed(2) を使い、+ は明示。
 */
function formatContribution(n: number): string {
  if (!Number.isFinite(n)) return '0.00';
  const fixed = Math.abs(n).toFixed(2);
  if (n > 0) return `+${fixed}`;
  if (n < 0) return `-${fixed}`;
  return '0.00';
}

/**
 * Modal / overlay のシート部分の共通スタイル。
 * Apple 風: 上部だけ大きな radius、内側 padding、border は薄く。
 */
function sheetContainerStyle(
  C: ReturnType<typeof useColors>,
  bottomInset: number,
): ViewStyle {
  return {
    backgroundColor: C.bg2,
    borderTopLeftRadius: R.lg,
    borderTopRightRadius: R.lg,
    paddingBottom: bottomInset + SP['3'],
    borderTopWidth: 1,
    borderTopColor: C.border,
    // iOS 風の subtle shadow (上方向)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 12,
  };
}

export default RankingExplainer;
