// ============================================================
// AutomodRuleEditor — Modal で AutoMod ルールを編集する GUI builder
// ============================================================
// Reddit ガイド 6.4 章 — YAML ではなく GUI で組み立てる。
//
// レイアウト:
//   ┌─ Modal (BlurView 風 backdrop, ZoomIn) ─────────────────┐
//   │  「新規ルール」 / 「ルールを編集」 (h3)                  │
//   │  ┌ 名前 (Input) ──────────────────────────────────┐   │
//   │  ┌ 説明 (TextArea) ───────────────────────────────┐   │
//   │  ┌ 条件 builder (複数 row 追加可能) ──────────────┐   │
//   │  │   matcher dropdown │ op dropdown │ value input │   │
//   │  └────────────────────────────────────────────────┘   │
//   │  ┌ action dropdown ──────────────────────────────┐   │
//   │  ┌ action_data (action 別に shape を変える) ─────┐   │
//   │  ┌ enabled Switch (作成時のみ表示) ──────────────┐   │
//   │  [キャンセル]  [保存] (gradient)                       │
//   └────────────────────────────────────────────────────────┘
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { PressableScale } from '../ui/PressableScale';
import { Input } from '../ui/Input';
import { TextArea } from '../ui/TextArea';
import { Toggle } from '../ui/Toggle';
import { PolishedButton } from '../ui/PolishedButton';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import type {
  AutomodAction,
  AutomodCondition,
  AutomodMatcher,
  AutomodOp,
} from '../../lib/utils/automodMatcher';
import type { AutomodRuleRow, CreateAutomodRuleInput } from '../../lib/api/automod';

// ============================================================
// 定数 — matcher / op / action のラベルとデフォルト
// ============================================================
const MATCHER_LABEL: Record<AutomodMatcher, string> = {
  author_age_days:    '作者のアカウント日数',
  author_trust_score: '作者の信頼スコア',
  post_content:       '投稿本文',
  post_tag_names:     '投稿のタグ',
  post_is_edited:     '編集されているか',
};

const MATCHERS: AutomodMatcher[] = [
  'author_age_days',
  'author_trust_score',
  'post_content',
  'post_tag_names',
  'post_is_edited',
];

const OP_LABEL: Record<AutomodOp, string> = {
  lt:       'より小さい (<)',
  lte:      '以下 (≤)',
  gt:       'より大きい (>)',
  gte:      '以上 (≥)',
  eq:       '等しい (=)',
  contains: 'を含む',
  regex:    '正規表現に一致',
  in:       'のいずれかに一致',
};

// matcher 別に許可する op
function opsFor(matcher: AutomodMatcher): AutomodOp[] {
  switch (matcher) {
    case 'author_age_days':
    case 'author_trust_score':
      return ['lt', 'lte', 'gt', 'gte', 'eq'];
    case 'post_content':
      return ['contains', 'regex'];
    case 'post_tag_names':
      return ['contains', 'in'];
    case 'post_is_edited':
      return ['eq'];
    default:
      return ['eq'];
  }
}

const ACTIONS: AutomodAction[] = ['hide', 'soft_warn', 'collapse', 'notify_admin'];

const ACTION_LABEL: Record<AutomodAction, string> = {
  hide:         '非表示にする',
  soft_warn:    '作者にやんわり通知',
  collapse:     '折りたたみタグを付与',
  notify_admin: '管理者に通知',
};

const ACTION_COLOR: Record<AutomodAction, string> = {
  hide:         C.red,
  soft_warn:    C.amber,
  collapse:     C.blue,
  notify_admin: C.accent,
};

// ============================================================
// 入力 state 型
// ============================================================
type EditorState = {
  name: string;
  description: string;
  enabled: boolean;
  conditions: AutomodCondition[];
  action: AutomodAction;
  action_data: Record<string, unknown>;
};

function emptyState(): EditorState {
  return {
    name: '',
    description: '',
    enabled: true,
    conditions: [
      { matcher: 'post_content', op: 'contains', value: '' },
    ],
    action: 'hide',
    action_data: {},
  };
}

function fromRule(rule: AutomodRuleRow): EditorState {
  return {
    name: rule.name,
    description: rule.description ?? '',
    enabled: rule.enabled,
    conditions: Array.isArray(rule.conditions)
      ? rule.conditions
      : [{ matcher: 'post_content', op: 'contains', value: '' }],
    action: rule.action,
    action_data: rule.action_data ?? {},
  };
}

// ============================================================
// 公開 API
// ============================================================
export type AutomodRuleEditorProps = {
  visible: boolean;
  initial?: AutomodRuleRow | null; // 編集時は既存値、新規時は null/undefined
  onCancel: () => void;
  onSave: (input: CreateAutomodRuleInput) => void;
  submitting?: boolean;
};

export function AutomodRuleEditor({
  visible,
  initial,
  onCancel,
  onSave,
  submitting,
}: AutomodRuleEditorProps) {
  const [state, setState] = useState<EditorState>(emptyState);
  const [error, setError] = useState<string | null>(null);

  // open する度に state を初期化 (init / 編集対象の切替時)
  useEffect(() => {
    if (visible) {
      setState(initial ? fromRule(initial) : emptyState());
      setError(null);
    }
  }, [visible, initial]);

  const canSave = useMemo(() => {
    if (state.name.trim().length === 0) return false;
    if (state.conditions.length === 0) return false;
    // value 必須
    for (const c of state.conditions) {
      const v = c.value;
      if (v === undefined || v === null) return false;
      if (typeof v === 'string' && v.length === 0) return false;
      if (Array.isArray(v) && v.length === 0) return false;
    }
    return true;
  }, [state]);

  function handleSave() {
    if (!canSave) {
      setError('名前と少なくとも 1 つの条件が必要です');
      return;
    }
    onSave({
      name: state.name.trim(),
      description: state.description.trim() || null,
      enabled: state.enabled,
      conditions: state.conditions,
      action: state.action,
      action_data: state.action_data,
    });
  }

  // ---- condition 編集ヘルパ ----
  function updateCondition(i: number, patch: Partial<AutomodCondition>) {
    setState((s) => {
      const next = [...s.conditions];
      const cur = next[i];
      if (!cur) return s;
      const merged: AutomodCondition = { ...cur, ...patch };
      // matcher を変えたら op / value を妥当な初期値に
      if (patch.matcher && patch.matcher !== cur.matcher) {
        const allowed = opsFor(merged.matcher);
        if (!allowed.includes(merged.op)) {
          const fallback = allowed[0];
          if (fallback) merged.op = fallback;
        }
        merged.value = defaultValueFor(merged.matcher);
      }
      next[i] = merged;
      return { ...s, conditions: next };
    });
  }

  function addCondition() {
    setState((s) => ({
      ...s,
      conditions: [...s.conditions, { matcher: 'post_content', op: 'contains', value: '' }],
    }));
  }

  function removeCondition(i: number) {
    setState((s) => {
      const next = [...s.conditions];
      next.splice(i, 1);
      return { ...s, conditions: next };
    });
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onCancel}>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(160)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          alignItems: 'center',
          justifyContent: 'center',
          padding: SP['4'],
        }}
      >
        {/* Backdrop click → cancel */}
        <Pressable
          onPress={onCancel}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <Animated.View
          entering={ZoomIn.duration(220)}
          exiting={ZoomOut.duration(160)}
          style={[
            {
              width: '100%',
              maxWidth: 560,
              maxHeight: '90%',
              backgroundColor: C.bg2,
              borderRadius: R.xl,
              borderWidth: 1,
              borderColor: C.border,
              overflow: 'hidden',
            },
            SHADOW.card,
          ]}
        >
          {/* ===== Header ===== */}
          <View
            style={{
              paddingHorizontal: SP['4'],
              paddingVertical: SP['3'],
              borderBottomWidth: 1,
              borderBottomColor: C.divider,
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <Text style={{ fontSize: 22 }}>🛡️</Text>
            <Text style={[T.h3, { color: C.text, flex: 1 }]} numberOfLines={1}>
              {initial ? 'ルールを編集' : '新規ルール'}
            </Text>
            <PressableScale
              onPress={onCancel}
              haptic="tap"
              hitSlop={10}
              style={{ padding: SP['1'] }}
              accessibilityLabel="閉じる"
            >
              <Icon.close size={18} color={C.text3} strokeWidth={2.4} />
            </PressableScale>
          </View>

          {/* ===== Scrollable body ===== */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              padding: SP['4'],
              gap: SP['4'],
            }}
          >
            {/* 名前 */}
            <Input
              label="ルール名 *"
              value={state.name}
              onChangeText={(v) => setState((s) => ({ ...s, name: v }))}
              placeholder="例: 新規アカウントの URL 投稿"
              maxLength={80}
            />

            {/* 説明 */}
            <TextArea
              label="説明 (任意)"
              value={state.description}
              onChangeText={(v) => setState((s) => ({ ...s, description: v }))}
              placeholder="このルールの目的を簡潔に"
              maxLength={500}
              minHeight={68}
            />

            {/* 条件 builder */}
            <View style={{ gap: SP['2'] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <Text style={[T.smallM, { color: C.text2, flex: 1 }]}>
                  条件 (すべて満たした時にマッチ) *
                </Text>
                <PressableScale
                  onPress={addCondition}
                  haptic="select"
                  hitSlop={6}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['2'],
                    paddingVertical: 6,
                    backgroundColor: C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Icon.plus size={14} color={C.text2} strokeWidth={2.4} />
                  <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>追加</Text>
                </PressableScale>
              </View>

              {state.conditions.map((c, i) => (
                <ConditionRow
                  key={`cond-${i}`}
                  index={i}
                  cond={c}
                  removable={state.conditions.length > 1}
                  onChange={(patch) => updateCondition(i, patch)}
                  onRemove={() => removeCondition(i)}
                />
              ))}
            </View>

            {/* action */}
            <View style={{ gap: SP['2'] }}>
              <Text style={[T.smallM, { color: C.text2 }]}>マッチした時の動作 *</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                {ACTIONS.map((a) => (
                  <ChoiceChip
                    key={a}
                    label={ACTION_LABEL[a]}
                    color={ACTION_COLOR[a]}
                    active={state.action === a}
                    onPress={() =>
                      setState((s) => ({
                        ...s,
                        action: a,
                        action_data: defaultActionData(a),
                      }))
                    }
                  />
                ))}
              </View>
            </View>

            {/* action_data — action 別に shape を変える */}
            <ActionDataFields
              action={state.action}
              data={state.action_data}
              onChange={(next) => setState((s) => ({ ...s, action_data: next }))}
            />

            {/* enabled toggle */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                paddingTop: SP['1'],
              }}
            >
              <Toggle
                value={state.enabled}
                onChange={(v) => setState((s) => ({ ...s, enabled: v }))}
              />
              <Text style={[T.body, { color: C.text }]}>
                {state.enabled ? 'このルールを有効化' : 'このルールを無効化'}
              </Text>
            </View>

            {error && (
              <View
                style={{
                  padding: SP['3'],
                  backgroundColor: C.redBg,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.red + '55',
                }}
              >
                <Text style={[T.small, { color: C.red }]}>{error}</Text>
              </View>
            )}
          </ScrollView>

          {/* ===== Footer ===== */}
          <View
            style={{
              paddingHorizontal: SP['4'],
              paddingVertical: SP['3'],
              borderTopWidth: 1,
              borderTopColor: C.divider,
              flexDirection: 'row',
              gap: SP['2'],
              justifyContent: 'flex-end',
            }}
          >
            <PolishedButton
              variant="glass"
              size="md"
              label="キャンセル"
              onPress={onCancel}
              haptic="tap"
            />
            <PolishedButton
              variant="gradient"
              gradient="primary"
              size="md"
              label={initial ? '更新する' : '作成する'}
              onPress={handleSave}
              haptic="confirm"
              disabled={!canSave || submitting}
              loading={submitting}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ============================================================
// ConditionRow — 1 つの条件 (matcher + op + value)
// ============================================================
function ConditionRow({
  cond,
  index,
  removable,
  onChange,
  onRemove,
}: {
  cond: AutomodCondition;
  index: number;
  removable: boolean;
  onChange: (patch: Partial<AutomodCondition>) => void;
  onRemove: () => void;
}) {
  const allowedOps = opsFor(cond.matcher);

  return (
    <View
      style={{
        padding: SP['3'],
        backgroundColor: C.bg3,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>
          #{index + 1}
        </Text>
        <View style={{ flex: 1 }} />
        {removable && (
          <PressableScale
            onPress={onRemove}
            haptic="warn"
            hitSlop={8}
            style={{ padding: 4 }}
            accessibilityLabel="この条件を削除"
          >
            <Icon.trash size={14} color={C.red} strokeWidth={2.4} />
          </PressableScale>
        )}
      </View>

      {/* matcher chips */}
      <View style={{ gap: 6 }}>
        <Text style={[T.caption, { color: C.text3 }]}>項目</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {MATCHERS.map((m) => (
            <ChoiceChip
              key={m}
              label={MATCHER_LABEL[m]}
              active={cond.matcher === m}
              onPress={() => onChange({ matcher: m })}
            />
          ))}
        </View>
      </View>

      {/* op chips */}
      <View style={{ gap: 6 }}>
        <Text style={[T.caption, { color: C.text3 }]}>条件</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {allowedOps.map((op) => (
            <ChoiceChip
              key={op}
              label={OP_LABEL[op]}
              active={cond.op === op}
              onPress={() => onChange({ op })}
            />
          ))}
        </View>
      </View>

      {/* value input — matcher / op に応じて変える */}
      <ValueInput cond={cond} onChange={onChange} />
    </View>
  );
}

// ============================================================
// ValueInput — matcher / op に応じた input
// ============================================================
function ValueInput({
  cond,
  onChange,
}: {
  cond: AutomodCondition;
  onChange: (patch: Partial<AutomodCondition>) => void;
}) {
  const { matcher, op, value } = cond;

  if (matcher === 'post_is_edited') {
    // boolean toggle
    const v = value === true || value === 'true';
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Toggle value={v} onChange={(next) => onChange({ value: next })} />
        <Text style={[T.body, { color: C.text }]}>
          {v ? '編集されている' : '編集されていない'}
        </Text>
      </View>
    );
  }

  if (matcher === 'author_age_days' || matcher === 'author_trust_score') {
    const numVal = typeof value === 'number' ? String(value) : String(value ?? '');
    return (
      <Input
        label="値 (数値)"
        keyboardType="number-pad"
        value={numVal}
        onChangeText={(v) => {
          const n = Number(v.replace(/[^\d-]/g, ''));
          onChange({ value: Number.isFinite(n) ? n : 0 });
        }}
        placeholder="例: 7"
        maxLength={10}
      />
    );
  }

  if (op === 'in') {
    // 配列入力 (カンマ区切り)
    const arr = Array.isArray(value) ? value : [];
    return (
      <Input
        label="値 (カンマ区切り)"
        value={arr.join(', ')}
        onChangeText={(v) =>
          onChange({
            value: v
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          })
        }
        placeholder="例: spam, ad, promo"
        maxLength={500}
      />
    );
  }

  // contains / regex / eq (文字列)
  const strVal = typeof value === 'string' ? value : String(value ?? '');
  return (
    <Input
      label={op === 'regex' ? '正規表現' : '値 (文字列)'}
      value={strVal}
      onChangeText={(v) => onChange({ value: v })}
      placeholder={op === 'regex' ? '例: https?://\\S+' : '例: discord.gg'}
      maxLength={500}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

// ============================================================
// ActionDataFields — action 別の追加 input
// ============================================================
function ActionDataFields({
  action,
  data,
  onChange,
}: {
  action: AutomodAction;
  data: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  if (action === 'hide') {
    // 何も入力不要
    return null;
  }
  if (action === 'soft_warn') {
    const msg = typeof data['message'] === 'string' ? (data['message'] as string) : '';
    return (
      <TextArea
        label="作者宛のメッセージ"
        value={msg}
        onChangeText={(v) => onChange({ ...data, message: v })}
        placeholder="例: 投稿内容に注意喚起があります"
        maxLength={500}
        minHeight={68}
      />
    );
  }
  if (action === 'collapse') {
    const tag = typeof data['tag'] === 'string' ? (data['tag'] as string) : '';
    return (
      <Input
        label="付与するタグ (未入力なら 'auto_collapsed')"
        value={tag}
        onChangeText={(v) => onChange({ ...data, tag: v })}
        placeholder="auto_collapsed"
        maxLength={40}
        autoCapitalize="none"
      />
    );
  }
  // notify_admin
  const title = typeof data['title'] === 'string' ? (data['title'] as string) : '';
  const body = typeof data['body'] === 'string' ? (data['body'] as string) : '';
  return (
    <View style={{ gap: SP['2'] }}>
      <Input
        label="通知タイトル"
        value={title}
        onChangeText={(v) => onChange({ ...data, title: v })}
        placeholder="AutoMod: ルール名"
        maxLength={120}
      />
      <TextArea
        label="通知本文"
        value={body}
        onChangeText={(v) => onChange({ ...data, body: v })}
        placeholder="どの post で何が引っかかったか"
        maxLength={1000}
        minHeight={68}
      />
    </View>
  );
}

// ============================================================
// ChoiceChip — small toggle chip (matcher / op / action 用)
// ============================================================
function ChoiceChip({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  color?: string;
}) {
  const accent = color ?? C.accent;
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: 6,
        backgroundColor: active ? accent + '22' : C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: active ? accent + '88' : C.border,
      }}
    >
      <Text
        style={[
          T.caption,
          {
            color: active ? accent : C.text2,
            fontWeight: '700',
          },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

// ============================================================
// matcher 切替時の value default
// ============================================================
function defaultValueFor(matcher: AutomodMatcher): AutomodCondition['value'] {
  switch (matcher) {
    case 'author_age_days':    return 7;
    case 'author_trust_score': return 30;
    case 'post_content':       return '';
    case 'post_tag_names':     return '';
    case 'post_is_edited':     return true;
  }
}

// ============================================================
// action 切替時の action_data default
// ============================================================
function defaultActionData(action: AutomodAction): Record<string, unknown> {
  switch (action) {
    case 'hide':         return {};
    case 'soft_warn':    return { message: '' };
    case 'collapse':     return { tag: 'auto_collapsed' };
    case 'notify_admin': return { title: '', body: '' };
  }
}
