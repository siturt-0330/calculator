import { useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { useIsAdmin, useAllFeedback, useUpdateFeedback } from '../../hooks/useAdmin';
import { useToastStore } from '../../stores/toastStore';
import { formatRelative } from '../../lib/utils/date';
import type { FeedbackKind, FeedbackRow, AdminFeedbackRow } from '../../lib/api/feedback';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

type StatusFilter = FeedbackRow['status'] | 'all';
type KindFilter = FeedbackKind | 'all';

const STATUS_META: Record<FeedbackRow['status'], { label: string; color: string; emoji: string }> = {
  open:         { label: '未対応',   color: '#E24B4A', emoji: '🔴' },
  triaged:      { label: '確認済み', color: '#F59E0B', emoji: '🟡' },
  in_progress: { label: '作業中',   color: '#7CB1FF', emoji: '🔵' },
  resolved:     { label: '解決済み', color: '#22D3A4', emoji: '🟢' },
  wontfix:      { label: '対応せず', color: '#94A3B8', emoji: '⚪' },
};

const KIND_META: Record<FeedbackKind, { label: string; emoji: string }> = {
  ui:         { label: 'UI',       emoji: '🎨' },
  bug:        { label: 'バグ',     emoji: '🐞' },
  typo:       { label: '誤字',     emoji: '✏️' },
  suggestion: { label: '提案',     emoji: '💡' },
  content:    { label: 'コンテンツ', emoji: '🚫' },
  other:      { label: 'その他',   emoji: '💬' },
};

export default function FeedbackAdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAdmin = useIsAdmin();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [kind, setKind] = useState<KindFilter>('all');
  const { feedback, isLoading } = useAllFeedback({ status, kind });
  const updateFeedback = useUpdateFeedback();
  const { show } = useToastStore();

  const counts = useMemo(() => {
    const counts: Record<string, number> = { all: feedback.length };
    for (const f of feedback) counts[f.status] = (counts[f.status] ?? 0) + 1;
    return counts;
  }, [feedback]);

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="フィードバック管理" left={<BackButton />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP['6'], gap: SP['4'] }}>
          <Text style={{ fontSize: 56 }}>🔒</Text>
          <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
            管理者専用ページ
          </Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 320 }]}>
            このページは管理者のみアクセスできます。Supabase で profiles.is_admin を true にすると見られます。
          </Text>
          <PressableScale
            onPress={() => router.back()}
            haptic="tap"
            style={{
              paddingHorizontal: SP['5'], paddingVertical: SP['3'],
              backgroundColor: C.bg3, borderRadius: R.full,
              borderWidth: 1, borderColor: C.border,
            }}
          >
            <Text style={[T.smallM, { color: C.text }]}>戻る</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="フィードバック管理"
        left={<BackButton />}
        right={
          <View style={{
            paddingHorizontal: SP['2'], paddingVertical: 4,
            backgroundColor: C.accentBg, borderRadius: R.full,
            borderWidth: 1, borderColor: C.accentSoft,
          }}>
            <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
              ADMIN
            </Text>
          </View>
        }
      />

      {/* ステータスフィルタ */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], gap: SP['2'] }}
      >
        <FilterPill
          active={status === 'all'}
          label={`すべて (${counts.all ?? 0})`}
          onPress={() => setStatus('all')}
        />
        {(Object.keys(STATUS_META) as FeedbackRow['status'][]).map((s) => {
          const meta = STATUS_META[s];
          return (
            <FilterPill
              key={s}
              active={status === s}
              label={`${meta.emoji} ${meta.label} (${counts[s] ?? 0})`}
              color={meta.color}
              onPress={() => setStatus(s)}
            />
          );
        })}
      </ScrollView>

      {/* カテゴリフィルタ */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['3'], gap: SP['2'] }}
      >
        <FilterPill
          active={kind === 'all'}
          label="全カテゴリ"
          onPress={() => setKind('all')}
        />
        {(Object.keys(KIND_META) as FeedbackKind[]).map((k) => {
          const meta = KIND_META[k];
          return (
            <FilterPill
              key={k}
              active={kind === k}
              label={`${meta.emoji} ${meta.label}`}
              onPress={() => setKind(k)}
            />
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['3'],
        }}
      >
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}>
            <Spinner />
          </View>
        ) : feedback.length === 0 ? (
          <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['3'] }}>
            <Text style={{ fontSize: 48 }}>📭</Text>
            <Text style={[T.body, { color: C.text2 }]}>
              該当するフィードバックはありません
            </Text>
          </View>
        ) : (
          feedback.map((f) => (
            <FeedbackCard
              key={f.id}
              item={f}
              onUpdate={async (updates) => {
                try {
                  await updateFeedback({ id: f.id, updates });
                  show('更新しました', 'success');
                } catch (e) {
                  show('更新に失敗しました', 'error');
                }
              }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function FilterPill({
  active, label, color, onPress,
}: { active: boolean; label: string; color?: string; onPress: () => void }) {
  const tone = color ?? C.accent;
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: 6,
        backgroundColor: active ? tone : C.bg3,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: active ? tone : C.border,
      }}
    >
      <Text style={[T.smallM, { color: active ? '#fff' : C.text, fontWeight: '700' }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

function FeedbackCard({
  item, onUpdate,
}: {
  item: AdminFeedbackRow;
  onUpdate: (updates: { status?: FeedbackRow['status']; admin_notes?: string }) => Promise<void>;
}) {
  const meta = STATUS_META[item.status];
  const kindMeta = KIND_META[item.kind];
  const [notesEditing, setNotesEditing] = useState(false);
  const [notes, setNotes] = useState(item.admin_notes ?? '');
  const [saving, setSaving] = useState(false);

  const saveNotes = async () => {
    setSaving(true);
    await onUpdate({ admin_notes: notes });
    setSaving(false);
    setNotesEditing(false);
  };

  return (
    <View style={{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }}>
      {/* ヘッダー: status + kind + 時刻 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <View style={{
          paddingHorizontal: SP['2'], paddingVertical: 2,
          backgroundColor: meta.color + '22',
          borderRadius: R.sm,
          borderWidth: 1, borderColor: meta.color + '55',
          flexDirection: 'row', alignItems: 'center', gap: 4,
        }}>
          <Text style={{ fontSize: 10 }}>{meta.emoji}</Text>
          <Text style={{ fontSize: 10, color: meta.color, fontWeight: '700' }}>
            {meta.label}
          </Text>
        </View>
        <View style={{
          paddingHorizontal: SP['2'], paddingVertical: 2,
          backgroundColor: C.bg3, borderRadius: R.sm,
          flexDirection: 'row', alignItems: 'center', gap: 4,
        }}>
          <Text style={{ fontSize: 10 }}>{kindMeta.emoji}</Text>
          <Text style={{ fontSize: 10, color: C.text2, fontWeight: '700' }}>
            {kindMeta.label}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[T.caption, { color: C.text3 }]}>
          {formatRelative(item.created_at)}
        </Text>
      </View>

      {/* 本文 */}
      <Text style={[T.body, { color: C.text, lineHeight: 22 }]}>
        {item.message}
      </Text>

      {/* メタ情報 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
        {item.route && (
          <Text style={[T.caption, { color: C.text3, fontFamily: 'monospace' }]}>
            📍 {item.route}
          </Text>
        )}
        {item.nickname && (
          <Text style={[T.caption, { color: C.text3 }]}>
            👤 {item.nickname}
          </Text>
        )}
        {item.screen_w && item.screen_h && (
          <Text style={[T.caption, { color: C.text3 }]}>
            📐 {item.screen_w}×{item.screen_h}
          </Text>
        )}
      </View>

      {/* 管理者メモ */}
      <View style={{
        marginTop: SP['1'],
        padding: SP['2'],
        backgroundColor: C.bg3,
        borderRadius: R.md,
        borderWidth: 1, borderColor: C.border,
        gap: SP['1'],
      }}>
        <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>📝 管理者メモ</Text>
        {notesEditing ? (
          <>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="対応状況をメモ..."
              placeholderTextColor={C.text3}
              multiline
              // memory DoS 対策: admin メモは 2000 文字 cap (一般的な長文上限)
              maxLength={2000}
              style={[T.small, { color: C.text, minHeight: 50 }]}
            />
            <View style={{ flexDirection: 'row', gap: SP['2'] }}>
              <PressableScale
                onPress={() => { setNotesEditing(false); setNotes(item.admin_notes ?? ''); }}
                haptic="tap"
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: 4,
                  backgroundColor: C.bg2, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.border,
                }}
              >
                <Text style={[T.caption, { color: C.text3 }]}>キャンセル</Text>
              </PressableScale>
              <PressableScale
                onPress={saveNotes}
                haptic="confirm"
                disabled={saving}
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: 4,
                  backgroundColor: C.accent, borderRadius: R.full,
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                }}
              >
                {saving && <ActivityIndicator size="small" color="#fff" />}
                <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>保存</Text>
              </PressableScale>
            </View>
          </>
        ) : (
          <PressableScale onPress={() => setNotesEditing(true)} haptic="tap">
            <Text style={[T.small, { color: item.admin_notes ? C.text : C.text3 }]}>
              {item.admin_notes || 'タップして追記...'}
            </Text>
          </PressableScale>
        )}
      </View>

      {/* ステータス変更ボタン */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['1'] }}>
        {(Object.keys(STATUS_META) as FeedbackRow['status'][]).map((s) => {
          const m = STATUS_META[s];
          const active = item.status === s;
          if (active) return null;
          return (
            <PressableScale
              key={s}
              onPress={() => onUpdate({ status: s })}
              haptic="tap"
              style={{
                paddingHorizontal: SP['2'], paddingVertical: 4,
                backgroundColor: 'transparent',
                borderRadius: R.full,
                borderWidth: 1, borderColor: m.color + '55',
                flexDirection: 'row', alignItems: 'center', gap: 3,
              }}
            >
              <Text style={{ fontSize: 9 }}>{m.emoji}</Text>
              <Text style={{ fontSize: 10, color: m.color, fontWeight: '600' }}>
                {m.label}にする
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}
