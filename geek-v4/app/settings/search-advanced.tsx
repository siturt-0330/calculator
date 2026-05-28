// ============================================================
// app/settings/search-advanced.tsx
// ------------------------------------------------------------
// 検索ランキング詳細 (Advanced) — 開発者 / admin 向けの透明性 UI。
//
// 役割:
//   - 現在 active な ranking signal の λ (lambda) / threshold を一覧で可視化
//   - admin のみ: クエリ例を入力して intent 反映後の weight を確認
//   - 自分の A/B group を表示 (自己 read のみ可能 / migration 0088)
//
// この画面はユーザー向けではなく、A/B テスト / debug のための view-only UI。
// settings/search-preferences.tsx の下に「Advanced (上級者向け)」リンクから
// 飛ぶ想定。
//
// 既存 settings 画面 (notifications.tsx / search-preferences.tsx) と統一:
//   - TopBar + BackButton + ScrollView
//   - C / SP / R / SIZE トークン (useColors theme 購読版)
//   - Reanimated 3 の FadeIn / FadeInDown で staggered intro
//   - TypeScript strict / any 禁止
// ============================================================

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Divider } from '../../components/ui/Divider';
import { useColors } from '../../hooks/useColors';
import { useIsAdmin } from '../../hooks/useAdmin';
import { useActiveRankingWeights, useWeightsForQuery } from '../../hooks/useSearchV4';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import { swallow } from '../../lib/swallow';
import type { ActiveWeights, RankingSignal } from '../../lib/api/searchV4';
import { R, SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

// ----------------------------------------------------------------
// signal_key の日本語ラベル + 補足説明 (人間向け透明性)
// ----------------------------------------------------------------
const SIGNAL_LABELS: Readonly<Record<RankingSignal, { label: string; hint: string }>> = {
  text_relevance: {
    label: 'テキスト一致度',
    hint: 'クエリと本文の一致 (BM25 等)',
  },
  recency: {
    label: '投稿の新しさ',
    hint: '直近の投稿ほど高スコア',
  },
  eeat: {
    label: '投稿者の信頼度',
    hint: 'Experience / Expertise / Authority / Trust',
  },
  usability: {
    label: 'コンテンツのユーザビリティ',
    hint: '読みやすさ / 構造 / メタ情報の充実度',
  },
  viewed_boost: {
    label: '閲覧履歴',
    hint: 'あなたが見たことのある投稿を優遇',
  },
  history_boost: {
    label: '検索履歴',
    hint: '過去の検索パターンとの整合性',
  },
  safety_negation: {
    label: '安全性 (負係数)',
    hint: 'NSFW / 違反疑いの投稿を抑制',
  },
  clickbait_negation: {
    label: 'クリックベイト抑制 (負係数)',
    hint: '釣りタイトル疑いを減点',
  },
  freshness: {
    label: '時事ネタ',
    hint: '今話題のトピックとの関連度',
  },
  diversity_penalty: {
    label: '多様性ペナルティ',
    hint: '同じ作者 / 同じトピックの連続を抑制',
  },
};

// 既知 signal の順序 — UI 表示順を固定 (server 側の順序に依存させない)
const SIGNAL_ORDER: readonly RankingSignal[] = [
  'text_relevance',
  'recency',
  'eeat',
  'usability',
  'viewed_boost',
  'history_boost',
  'freshness',
  'safety_negation',
  'clickbait_negation',
  'diversity_penalty',
];

function sortWeights(weights: ActiveWeights): ActiveWeights {
  const idx = new Map<RankingSignal, number>();
  SIGNAL_ORDER.forEach((k, i) => idx.set(k, i));
  return [...weights].sort((a, b) => {
    const ai = idx.get(a.signal_key) ?? 999;
    const bi = idx.get(b.signal_key) ?? 999;
    return ai - bi;
  });
}

// ----------------------------------------------------------------
// 自分の A/B group を取得する小型 hook
// ------------------------------------------------------------
// migration 0088 の user_ab_assignment テーブルは RLS で
//   uaa_read_self (auth.uid() = user_id) が貼られており、
// 自分の row だけは直接 select できる。get_my_ab_group RPC は未実装なので、
// supabase.from を 1 行だけ叩いて結果を読み取る。
//
// 失敗時 / 未割当時は null を返す (UI 側は "default" 表記に fallback)。
// ----------------------------------------------------------------
function useMyAbGroup(): { abGroup: string | null; isLoading: boolean } {
  const userId = useAuthStore((s) => s.user?.id);
  const [abGroup, setAbGroup] = useState<string | null>(null);
  const [isLoading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setAbGroup(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_ab_assignment')
          .select('ab_group')
          .eq('user_id', userId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          swallow('search-advanced.fetchAbGroup', error);
          setAbGroup(null);
        } else {
          const row = data as { ab_group?: string | null } | null;
          setAbGroup(row?.ab_group ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          swallow('search-advanced.fetchAbGroup.catch', e);
          setAbGroup(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { abGroup, isLoading };
}

// ============================================================
// 画面本体
// ============================================================
export default function SearchAdvancedScreen() {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const isAdmin = useIsAdmin();
  const { abGroup, isLoading: abLoading } = useMyAbGroup();

  const activeWeightsQ = useActiveRankingWeights();
  const sortedWeights: ActiveWeights = sortWeights(activeWeightsQ.data ?? []);

  // admin 向け: クエリ例を入力して intent 反映後の weight を見る
  const [queryExample, setQueryExample] = useState<string>('');
  const weightsForQueryQ = useWeightsForQuery(queryExample);
  const sortedQueryWeights: ActiveWeights = sortWeights(weightsForQueryQ.data ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="検索ランキング詳細" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        {/* 説明文 (subtle) */}
        <Animated.View entering={FadeIn.duration(200)}>
          <View
            style={{
              padding: SP['4'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
              flexDirection: 'row',
              alignItems: 'flex-start',
            }}
          >
            <Icon.info size={20} color={C.accent} strokeWidth={2} />
            <Text style={[T.small, { color: C.text2, flex: 1 }]}>
              各シグナルがあなたの検索結果ランキングにどのくらい影響するかを表示します。
              これは A/B テスト用の設定で、変更すると検索結果が変わります。
            </Text>
          </View>
        </Animated.View>

        {/* Section: 現在のシグナル一覧 */}
        <Animated.View entering={FadeInDown.duration(220).delay(40)}>
          <SectionHeader title="現在のシグナル一覧" />
          <SignalList
            weights={sortedWeights}
            isLoading={activeWeightsQ.isLoading}
            emptyText="active な weight が取得できませんでした"
          />
        </Animated.View>

        {/* Section: Intent 別の調整 (admin only) */}
        {isAdmin && (
          <Animated.View entering={FadeInDown.duration(220).delay(80)}>
            <SectionHeader title="Intent 別の調整" subtitle="admin のみ" />
            <View
              style={{
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                padding: SP['4'],
                gap: SP['3'],
              }}
            >
              <Text style={[T.caption, { color: C.text3 }]}>
                クエリ例を入力すると、intent 分類後の weight が表示されます (例:「料理」「最新ニュース」)。
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['2'],
                  paddingHorizontal: SP['3'],
                  height: SIZE.input,
                  backgroundColor: C.bg3,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Icon.search size={16} color={C.text3} strokeWidth={2.2} />
                <TextInput
                  value={queryExample}
                  onChangeText={setQueryExample}
                  placeholder="クエリを入力 (例: 料理)"
                  placeholderTextColor={C.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={128}
                  accessibilityLabel="クエリ例の入力欄"
                  style={[T.body, { color: C.text, flex: 1, paddingVertical: 0 }]}
                />
                {weightsForQueryQ.isFetching && queryExample.trim().length > 0 && (
                  <ActivityIndicator size="small" color={C.accent} />
                )}
              </View>
              {queryExample.trim().length === 0 ? (
                <Text style={[T.caption, { color: C.text4 }]}>
                  クエリを入力すると重み一覧がここに表示されます。
                </Text>
              ) : (
                <View style={{ gap: SP['2'] }}>
                  <Text style={[T.smallM, { color: C.text2 }]}>
                    「{queryExample.trim()}」に対する重み
                  </Text>
                  <SignalList
                    weights={sortedQueryWeights}
                    isLoading={weightsForQueryQ.isLoading}
                    emptyText="このクエリでは intent 別 weight が取得できませんでした"
                    flat
                  />
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* Section: 現在の A/B グループ */}
        <Animated.View entering={FadeInDown.duration(220).delay(120)}>
          <SectionHeader title="現在の A/B グループ" />
          <View
            style={{
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              padding: SP['4'],
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
            }}
            accessibilityLabel={
              abLoading
                ? 'A/B グループを読み込み中'
                : `あなたは ${abGroup ?? 'default'} グループです`
            }
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: C.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.flag size={16} color={C.accent} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              {abLoading ? (
                <Text style={[T.body, { color: C.text3 }]}>読み込み中…</Text>
              ) : (
                <>
                  <Text style={[T.caption, { color: C.text3 }]}>あなたは</Text>
                  <Text style={[T.bodyB, { color: C.text }]}>
                    <Text style={[T.bodyB, { color: C.accentLight }]}>
                      “{abGroup ?? 'default'}”
                    </Text>
                    <Text style={[T.body, { color: C.text2 }]}> グループです</Text>
                  </Text>
                </>
              )}
            </View>
          </View>
        </Animated.View>

        {/* Footer note */}
        <Animated.View entering={FadeIn.duration(220).delay(160)}>
          <View
            style={{
              padding: SP['4'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Icon.shield size={14} color={C.text3} strokeWidth={2.2} />
              <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>
                編集権限について
              </Text>
            </View>
            <Text style={[T.caption, { color: C.text3 }]}>
              これらの値は admin が変更します。一般ユーザーは閲覧のみ可能です。
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ============================================================
// SectionHeader — section title + optional subtitle (例: "admin のみ")
// ============================================================
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const C = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingHorizontal: SP['2'],
        marginBottom: SP['2'],
      }}
    >
      <Text style={[T.smallM, { color: C.text3 }]}>{title}</Text>
      {subtitle ? (
        <View
          style={{
            paddingHorizontal: SP['2'],
            paddingVertical: 2,
            backgroundColor: C.accentSoft,
            borderRadius: R.full,
          }}
        >
          <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
            {subtitle}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ============================================================
// SignalList — weights を card に並べる
// ------------------------------------------------------------
// flat=true のときは外側カードを描画せず、行のみを返す
// (Intent 別調整の二重カード回避用)。
// ============================================================
function SignalList({
  weights,
  isLoading,
  emptyText,
  flat,
}: {
  weights: ActiveWeights;
  isLoading: boolean;
  emptyText: string;
  flat?: boolean;
}) {
  const C = useColors();

  const body =
    weights.length === 0 ? (
      <View
        style={{
          padding: SP['4'],
          alignItems: 'center',
          justifyContent: 'center',
          gap: SP['2'],
        }}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={C.accent} />
        ) : (
          <Text style={[T.small, { color: C.text3 }]}>{emptyText}</Text>
        )}
      </View>
    ) : (
      <View style={{ opacity: isLoading ? 0.6 : 1 }}>
        {weights.map((w, i) => (
          <View key={w.signal_key}>
            <SignalRow
              signalKey={w.signal_key}
              lambda={w.effective_lambda}
              threshold={w.threshold}
            />
            {i < weights.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </View>
    );

  if (flat) return body;

  return (
    <View
      style={{
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}
    >
      {body}
    </View>
  );
}

// ============================================================
// SignalRow — 1 signal の表示
// ------------------------------------------------------------
// A11y:
//   - accessibilityLabel に「ラベル / lambda / threshold」をスペース区切りで
//     読み上げ用に組み立て (screen reader 対応)
//   - 表示用テキストは「数値」と「単位 (λ / 閾値)」を別 Text に分離して
//     accessibility 上で意味付けしやすくする
// ============================================================
function SignalRow({
  signalKey,
  lambda,
  threshold,
}: {
  signalKey: RankingSignal;
  lambda: number;
  threshold: number;
}) {
  const C = useColors();
  const meta = SIGNAL_LABELS[signalKey];

  // 負係数 (safety_negation / clickbait_negation / diversity_penalty) は赤系で表示
  const isNegative = lambda < 0;
  const lambdaColor = isNegative ? C.red : C.accentLight;

  const lambdaText = formatNumber(lambda);
  const thresholdText = formatNumber(threshold);

  const a11y = `${meta.label}, λ ${lambdaText}, 閾値 ${thresholdText}`;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={a11y}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: SP['4'],
        gap: SP['3'],
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.body, { color: C.text }]}>{meta.label}</Text>
        <Text style={[T.caption, { color: C.text3 }]}>{meta.hint}</Text>
        <Text style={[T.caption, { color: C.text4 }]}>{signalKey}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2, minWidth: 96 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text style={[T.caption, { color: C.text3 }]}>λ</Text>
          <Text style={[T.numLg, { color: lambdaColor }]}>{lambdaText}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text style={[T.caption, { color: C.text3 }]}>閾値</Text>
          <Text style={[T.num, { color: C.text2 }]}>{thresholdText}</Text>
        </View>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------
// 数値整形: 4 桁有効数字 + trailing 0 を削除
// ----------------------------------------------------------------
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  // 0.001 〜 999 想定。小数 4 桁で丸めて trailing 0 を削る。
  const rounded = Math.round(n * 10000) / 10000;
  if (Object.is(rounded, -0)) return '0';
  const s = rounded.toFixed(4);
  // 4 桁全部が trailing 0 なら整数表記、それ以外は末尾 0 を削る
  if (s.endsWith('.0000')) return rounded.toFixed(0);
  return s.replace(/0+$/, '').replace(/\.$/, '');
}
