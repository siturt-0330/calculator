// ============================================================
// /admin/automod — AutoMod (条件ベース自動モデレーション) 管理画面
// ============================================================
// Reddit ガイド #8 / 6.4 章 — YAML ではなく GUI で組み立てる。
//
// 構成:
//   [Hero] 「自動モデレーション」+ DEV badge + 説明
//   [Stats] 直近 24h のマッチ数 (全体 + アクション別)
//   [SectionHeader] ルール (右上に「+ 新規」 gradient pill)
//   [List] AutomodRuleCard を縦に並べる
//   [Modal] AutomodRuleEditor (新規 / 編集兼用)
//   [Confirm] 削除確認 (ConfirmDialog)
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyBlock, ErrorBlock } from '../../components/admin/AdminBlocks';
import { AutomodRuleEditor } from '../../components/admin/AutomodRuleEditor';
import { AutomodRuleCard } from '../../components/admin/AutomodRuleCard';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW, GRAD } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import {
  useAutomodRules,
  useAutomodStats24h,
  useCreateAutomodRule,
  useUpdateAutomodRule,
  useDeleteAutomodRule,
  useToggleAutomodRule,
} from '../../hooks/useAutomodRules';
import type { AutomodRuleRow, CreateAutomodRuleInput } from '../../lib/api/automod';

export default function AdminAutomodScreen() {
  const insets = useSafeAreaInsets();
  const { rules, isLoading, error, refetch } = useAutomodRules();
  const statsQ = useAutomodStats24h();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AutomodRuleRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AutomodRuleRow | null>(null);

  const createM = useCreateAutomodRule();
  const updateM = useUpdateAutomodRule();
  const deleteM = useDeleteAutomodRule();
  const toggleM = useToggleAutomodRule();

  const openNew = useCallback(() => {
    setEditing(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((rule: AutomodRuleRow) => {
    setEditing(rule);
    setEditorOpen(true);
  }, []);

  const handleSave = useCallback(
    (input: CreateAutomodRuleInput) => {
      if (editing) {
        updateM.mutate(
          { id: editing.id, patch: input },
          {
            onSuccess: () => {
              setEditorOpen(false);
              setEditing(null);
            },
          },
        );
      } else {
        createM.mutate(input, {
          onSuccess: () => {
            setEditorOpen(false);
          },
        });
      }
    },
    [editing, createM, updateM],
  );

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    deleteM.mutate(pendingDelete.id);
    setPendingDelete(null);
  }, [pendingDelete, deleteM]);

  const submitting = createM.isPending || updateM.isPending;

  const totalEnabled = useMemo(() => rules.filter((r) => r.enabled).length, [rules]);
  const totalMatches24h = statsQ.data?.totalMatches ?? 0;
  const byRule24h = statsQ.data?.byRule ?? {};

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="自動モデレーション"
        left={<BackButton />}
        right={
          <PressableScale
            onPress={() => {
              void refetch();
              void statsQ.refetch();
            }}
            haptic="tap"
            hitSlop={10}
            style={{
              width: 34,
              height: 34,
              borderRadius: R.full,
              backgroundColor: C.bg3,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: C.border,
            }}
            accessibilityLabel="再読み込み"
          >
            <Icon.sparkles size={14} color={C.text2} strokeWidth={2.2} />
          </PressableScale>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['10'],
          paddingTop: SP['2'],
          gap: SP['4'],
        }}
      >
        {/* ====== Hero ====== */}
        <View style={{ paddingHorizontal: SP['4'] }}>
          <View
            style={[
              {
                padding: SP['4'],
                backgroundColor: C.bg2,
                borderRadius: R.xl,
                borderWidth: 1,
                borderColor: C.border,
                gap: SP['2'],
                overflow: 'hidden',
              },
              SHADOW.card,
            ]}
          >
            <LinearGradient
              colors={[C.accent + '22', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              pointerEvents="none"
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={{ fontSize: 28 }}>🛡️</Text>
              <Text
                style={{
                  fontFamily: FONT.display,
                  fontSize: 22,
                  lineHeight: 26,
                  color: C.text,
                  letterSpacing: -0.4,
                }}
              >
                AutoMod
              </Text>
              <View
                style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: 2,
                  backgroundColor: C.redBg,
                  borderRadius: R.sm,
                  borderWidth: 1,
                  borderColor: C.red + '55',
                }}
              >
                <Text style={{ fontSize: 9, color: C.red, fontWeight: '800', letterSpacing: 0.6 }}>
                  DEV
                </Text>
              </View>
            </View>
            <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>
              条件ベースの自動モデレーション。新規アカウント・特定キーワード・タグ等を「項目 × 条件 × 値」で組み合わせて、
              非表示 / 注意通知 / 折りたたみ / 管理者通知 を自動実行します。
            </Text>
          </View>
        </View>

        {/* ====== Stats ====== */}
        <View style={{ paddingHorizontal: SP['4'] }}>
          <View
            style={{
              flexDirection: 'row',
              gap: SP['2'],
              flexWrap: 'wrap',
            }}
          >
            <MetricCard
              label="ルール数"
              value={String(rules.length)}
              hint={`有効 ${totalEnabled} 件`}
            />
            <MetricCard
              label="直近 24h マッチ"
              value={String(totalMatches24h)}
              hint="全 rule 合算"
              tone={totalMatches24h > 0 ? 'amber' : 'neutral'}
            />
          </View>
        </View>

        {/* ====== Section: rules ====== */}
        <View>
          <SectionHeader
            label="ルール一覧"
            right={
              <PressableScale
                onPress={openNew}
                haptic="confirm"
                style={[
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 7,
                    borderRadius: R.full,
                    overflow: 'hidden',
                  },
                  SHADOW.glow,
                ]}
                accessibilityLabel="新規ルール"
              >
                <LinearGradient
                  colors={GRAD.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
                <Icon.plus size={14} color="#fff" strokeWidth={2.6} />
                <Text style={[T.smallB, { color: '#fff', fontSize: 12 }]}>新規ルール</Text>
              </PressableScale>
            }
          />

          <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
            {isLoading ? (
              <View style={{ padding: SP['8'], alignItems: 'center' }}>
                <Spinner />
              </View>
            ) : error ? (
              <ErrorBlock
                message="ルールを取得できませんでした"
                onRetry={() => void refetch()}
              />
            ) : rules.length === 0 ? (
              <EmptyBlock emoji="🛡️" label="まだルールがありません。「新規ルール」から作成してください。" />
            ) : (
              rules.map((r, i) => (
                <Animated.View
                  key={r.id}
                  entering={FadeInDown.duration(220).delay(Math.min(i, 8) * 20)}
                  layout={Layout.springify()}
                >
                  <AutomodRuleCard
                    rule={r}
                    todayMatches={byRule24h[r.id] ?? 0}
                    toggling={toggleM.isPending && toggleM.variables?.id === r.id}
                    onToggle={(enabled) => toggleM.mutate({ id: r.id, enabled })}
                    onEdit={() => openEdit(r)}
                    onDelete={() => setPendingDelete(r)}
                  />
                </Animated.View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* ====== Editor modal ====== */}
      <AutomodRuleEditor
        visible={editorOpen}
        initial={editing}
        onCancel={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        submitting={submitting}
      />

      {/* ====== Delete confirm ====== */}
      <ConfirmDialog
        visible={pendingDelete !== null}
        title="ルールを削除"
        message={
          pendingDelete
            ? `「${pendingDelete.name}」を削除します。マッチ履歴 (automod_log) も同時に削除されます。\n\n累計マッチ: ${pendingDelete.match_count} 件`
            : ''
        }
        confirmLabel="削除する"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}

// ============================================================
// SectionHeader — admin/index.tsx と同じパターン
// ============================================================
function SectionHeader({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingHorizontal: SP['4'],
        paddingBottom: SP['2'],
        paddingTop: SP['2'],
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: '800',
          color: C.text3,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
      {right}
    </View>
  );
}

// ============================================================
// MetricCard — Stats 1 件用 (KpiCard より小さい / 横並び 2 列)
// ============================================================
type Tone = 'neutral' | 'amber' | 'red' | 'accent';
const TONE_PAL: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: C.text,        bg: C.bg2,      border: C.border },
  amber:   { fg: C.amber,       bg: C.amberBg,  border: C.amber + '55' },
  red:     { fg: C.red,         bg: C.redBg,    border: C.red + '55' },
  accent:  { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
};

function MetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  const p = TONE_PAL[tone];
  return (
    <View
      style={[
        {
          flexBasis: '48%',
          flexGrow: 1,
          backgroundColor: p.bg,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: p.border,
          padding: SP['3'],
          gap: 4,
        },
        SHADOW.card,
      ]}
    >
      <Text
        style={{
          fontFamily: FONT.uiBold,
          fontSize: 26,
          lineHeight: 30,
          color: p.fg,
          fontWeight: '700',
          letterSpacing: -0.4,
        }}
      >
        {value}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: SP['2'],
        }}
      >
        <Text
          style={{
            fontSize: 10,
            color: C.text3,
            fontWeight: '700',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {hint && (
          <Text style={{ fontSize: 9, color: C.text4, fontWeight: '600' }} numberOfLines={1}>
            {hint}
          </Text>
        )}
      </View>
    </View>
  );
}
