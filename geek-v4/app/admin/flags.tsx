// ============================================================
// /admin/flags — 機能フラグ管理 (WordPress 的「ポチポチ」トグル画面)
// ------------------------------------------------------------
// feature_flags テーブルをブラウザの管理画面から直接 ON/OFF・percentage 変更・
// 新規作成できる。変更は useUserChannel の realtime 経由で全クライアントの
// ['feature-flags'] cache が即 invalidate される = 再デプロイなしで全端末反映。
//
// 前提 migration: 0147 (テーブル) + 0148 (ff_admin_write RLS + updated_at trigger)。
// client gate は admin/_layout.tsx (admin email のみ)、server gate は is_admin() RLS。
// ============================================================
import { useMemo, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyBlock, ErrorBlock } from '../../components/admin/AdminBlocks';
import { Icon } from '../../constants/icons';
import { useToastStore } from '../../stores/toastStore';
import {
  fetchAdminFeatureFlags,
  updateFeatureFlag,
  createFeatureFlag,
  type AdminFeatureFlag,
} from '../../lib/api/adminFlags';
import { formatRelative } from '../../lib/utils/date';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T, FONT } from '../../design/typography';

const QK = ['admin-flags'];
// ロールアウト % のプリセット (細かい数値入力より誤操作が少ない)
const PERCENT_PRESETS = [0, 10, 25, 50, 100] as const;

export default function AdminFlagsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QK,
    queryFn: fetchAdminFeatureFlags,
    staleTime: 10_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: QK });
    // クライアント側の判定 cache (useFeatureFlags) も即時更新
    void qc.invalidateQueries({ queryKey: ['feature-flags'] });
  };

  const update = useMutation({
    mutationFn: ({ name, patch }: { name: string; patch: { enabled?: boolean; percentage?: number } }) =>
      updateFeatureFlag(name, patch),
    onSuccess: () => invalidate(),
    onError: (e: Error) => {
      show(`更新に失敗: ${e.message}`, 'error');
      invalidate(); // 楽観表示を真値に戻す
    },
  });

  const enabledCount = useMemo(() => (data ?? []).filter((f) => f.enabled).length, [data]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title=" " left={<BackButton />} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
      >
        {/* ============ Header ============ */}
        <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['1'], paddingBottom: SP['3'] }}>
          <Text
            style={{
              fontFamily: FONT.display,
              fontSize: 30,
              lineHeight: 36,
              color: C.text,
              letterSpacing: -0.6,
            }}
          >
            機能フラグ
          </Text>
          <Text style={[T.caption, { color: C.text3, marginTop: 4 }]}>
            トグルすると全クライアントに即時反映されます (再デプロイ不要・realtime 連動)
            {data ? ` · ${enabledCount}/${data.length} 有効` : ''}
          </Text>
        </View>

        {/* ============ 新規作成 ============ */}
        <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
          {creating ? (
            <CreateFlagForm
              onDone={() => {
                setCreating(false);
                invalidate();
              }}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <PressableScale
              onPress={() => setCreating(true)}
              haptic="tap"
              style={{
                padding: SP['3'],
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.accent + '55',
                borderStyle: 'dashed',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: SP['2'],
              }}
            >
              <Icon.plus size={16} color={C.accentLight} strokeWidth={2.4} />
              <Text style={[T.smallB, { color: C.accentLight }]}>新しいフラグを作る</Text>
            </PressableScale>
          )}
        </View>

        {/* ============ フラグ一覧 ============ */}
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          {isLoading ? (
            <View style={{ padding: SP['8'], alignItems: 'center' }}>
              <Spinner />
            </View>
          ) : error ? (
            <ErrorBlock
              message={'フラグを取得できませんでした\n(migration 0147/0148 が未適用の可能性)'}
              onRetry={() => void refetch()}
            />
          ) : (data ?? []).length === 0 ? (
            <EmptyBlock emoji="🚩" label="フラグがまだありません (0147 を適用すると初期フラグが入ります)" />
          ) : (
            (data ?? []).map((f) => (
              <FlagRow
                key={f.name}
                flag={f}
                busy={update.isPending && update.variables?.name === f.name}
                onToggle={(v) => update.mutate({ name: f.name, patch: { enabled: v } })}
                onPercent={(p) => update.mutate({ name: f.name, patch: { percentage: p } })}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ============================================================
// FlagRow — 1 フラグ = 1 カード (トグル + ロールアウト %)
// ============================================================
function FlagRow({
  flag,
  busy,
  onToggle,
  onPercent,
}: {
  flag: AdminFeatureFlag;
  busy: boolean;
  onToggle: (v: boolean) => void;
  onPercent: (p: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View
      style={[
        {
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: flag.enabled ? C.accent + '44' : C.border,
          gap: SP['2'],
          opacity: busy ? 0.7 : 1,
        },
        SHADOW.card,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
            <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
              {flag.name}
            </Text>
            {/* percentage バッジ (100% 以外 = 部分ロールアウト中) */}
            {flag.percentage < 100 && (
              <View
                style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: 1,
                  backgroundColor: C.amberBg,
                  borderRadius: R.sm,
                  borderWidth: 1,
                  borderColor: C.amber + '55',
                }}
              >
                <Text style={{ fontSize: 11, color: C.amber, fontWeight: '700' }}>
                  {flag.percentage}%
                </Text>
              </View>
            )}
          </View>
          {!!flag.description && (
            <Text style={[T.caption, { color: C.text3 }]} numberOfLines={2}>
              {flag.description}
            </Text>
          )}
          <Text style={[T.caption, { color: C.text4 }]}>
            更新 {formatRelative(flag.updated_at)}
          </Text>
        </View>
        <Switch
          value={flag.enabled}
          onValueChange={onToggle}
          disabled={busy}
          trackColor={{ false: C.bg4, true: C.accent }}
          thumbColor="#fff"
        />
      </View>

      {/* ロールアウト % (タップで展開 — 普段は隠して誤操作を防ぐ) */}
      <PressableScale onPress={() => setExpanded((v) => !v)} haptic="tap" hitSlop={6}>
        <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
          {expanded ? '× ロールアウト設定を閉じる' : `ロールアウト ${flag.percentage}% — 変更する`}
        </Text>
      </PressableScale>
      {expanded && (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {PERCENT_PRESETS.map((p) => {
            const active = flag.percentage === p;
            return (
              <PressableScale
                key={p}
                onPress={() => onPercent(p)}
                haptic="select"
                disabled={busy || active}
                style={{
                  paddingHorizontal: SP['3'],
                  paddingVertical: 6,
                  backgroundColor: active ? C.accentBg : C.bg3,
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: active ? C.accent + '66' : C.border,
                }}
              >
                <Text
                  style={[T.caption, { color: active ? C.accentLight : C.text2, fontWeight: '700' }]}
                >
                  {p}%
                </Text>
              </PressableScale>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ============================================================
// CreateFlagForm — 新規フラグ作成 (name / description / 初期 ON-OFF)
// ============================================================
function CreateFlagForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const show = useToastStore((s) => s.show);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(false);

  const create = useMutation({
    mutationFn: () => createFeatureFlag({ name, description, enabled }),
    onSuccess: () => {
      show('フラグを作成しました', 'success');
      onDone();
    },
    onError: (e: Error) => show(`作成に失敗: ${e.message}`, 'error'),
  });

  return (
    <View
      style={{
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.accent + '55',
        gap: SP['2'],
      }}
    >
      <Text style={[T.smallB, { color: C.accentLight }]}>新しいフラグ</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="フラグ名 (例: contest_mode)"
        placeholderTextColor={C.text3}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={64}
        style={[
          T.body,
          {
            color: C.text,
            backgroundColor: C.bg3,
            borderRadius: R.md,
            paddingHorizontal: SP['3'],
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: C.border,
          },
        ]}
      />
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="説明 (何を切り替えるフラグ?)"
        placeholderTextColor={C.text3}
        maxLength={200}
        style={[
          T.body,
          {
            color: C.text,
            backgroundColor: C.bg3,
            borderRadius: R.md,
            paddingHorizontal: SP['3'],
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: C.border,
          },
        ]}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Text style={[T.small, { color: C.text2, flex: 1 }]}>作成時から有効にする</Text>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ false: C.bg4, true: C.accent }}
          thumbColor="#fff"
        />
      </View>
      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end' }}>
        <PressableScale
          onPress={onCancel}
          haptic="tap"
          style={{
            paddingHorizontal: SP['4'],
            paddingVertical: 8,
            backgroundColor: C.bg3,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text style={[T.smallB, { color: C.text2 }]}>キャンセル</Text>
        </PressableScale>
        <PressableScale
          onPress={() => create.mutate()}
          haptic="confirm"
          disabled={create.isPending || name.trim().length < 3}
          style={{
            paddingHorizontal: SP['4'],
            paddingVertical: 8,
            backgroundColor: C.accent,
            borderRadius: R.full,
            opacity: create.isPending || name.trim().length < 3 ? 0.5 : 1,
          }}
        >
          <Text style={[T.smallB, { color: '#fff' }]}>作成する</Text>
        </PressableScale>
      </View>
    </View>
  );
}
