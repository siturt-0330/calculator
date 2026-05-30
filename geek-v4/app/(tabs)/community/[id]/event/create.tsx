// ============================================================
// イベント作成 (community event create) — 2026-05 UI polish
// ------------------------------------------------------------
// 入力: タイトル / 説明 / 日時 / 会場 spot / 場所テキスト
//
// デザイン: spot create と同じ「Card + 必須/任意 badge + sticky CTA」パターン。
//   - セクションごとに Card (bg2 + border + radius)
//   - 必須 / 任意 badge を右肩に
//   - 文字数カウンター (タイトル / 説明)
//   - 日時入力は web 上で <input type=datetime-local> 体験に近づくよう
//     placeholder + 解釈プレビュー (人間に読める日付に解釈) を 1 枚で
//   - 登録ボタンは sticky bottom
//
// 日時はネイティブ DateTimePicker を入れる前のシンプルな実装。
// 入力値は Date 化して有効性チェック → ISO で API へ。
// ============================================================
import { View, Text, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '../../../../../design/tokens';
import { T } from '../../../../../design/typography';
import { BackButton } from '../../../../../components/nav/BackButton';
import { Input } from '../../../../../components/ui/Input';
import { Button } from '../../../../../components/ui/Button';
import { Icon } from '../../../../../constants/icons';
import { useToastStore } from '../../../../../stores/toastStore';
import { createEvent } from '../../../../../lib/api/communities';
import { EventSpotPicker } from '../../../../../components/community/EventSpotPicker';
import { TABBAR } from '../../../../../design/tabbar';

// "YYYY-MM-DDTHH:MM" な local datetime → Date
function parseLocalDateTime(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 今を基準にした初期値 (datetime-local 形式)
function defaultStartsAt(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60 - d.getMinutes()); // 次の正時
  d.setSeconds(0);
  d.setMilliseconds(0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

const DT_PLACEHOLDER = 'YYYY-MM-DDTHH:MM';

export default function CreateEventScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { show } = useToastStore();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStartsAt());
  const [endsAt, setEndsAt] = useState('');
  const [locationText, setLocationText] = useState('');
  const [spotId, setSpotId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const startsDate = useMemo(() => parseLocalDateTime(startsAt), [startsAt]);
  const endsDate = useMemo(() => parseLocalDateTime(endsAt), [endsAt]);
  const endsAfterStarts =
    !endsDate || !startsDate || endsDate.getTime() > startsDate.getTime();
  const canSubmit =
    title.trim().length > 0 && startsDate !== null && endsAfterStarts && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !startsDate) return;
    setSubmitting(true);
    const { error } = await createEvent({
      community_id: id,
      title: title.trim(),
      description: description.trim() || undefined,
      starts_at: startsDate.toISOString(),
      ends_at: endsDate ? endsDate.toISOString() : undefined,
      location_text: locationText.trim() || undefined,
      spot_id: spotId,
    });
    setSubmitting(false);
    if (error) {
      show(error, 'error');
      return;
    }
    show('イベントを登録しました', 'success');
    void qc.invalidateQueries({ queryKey: ['community', id, 'events'] });
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>イベントを追加</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['2'],
          paddingBottom: TABBAR.height + insets.bottom + SP['24'], // sticky CTA 分
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ───────── タイトル ───────── */}
        <Card>
          <SectionHeader
            title="タイトル"
            badge={{ kind: 'required' }}
            right={
              <Text style={[T.caption, { color: title.length > 90 ? C.amber : C.text3 }]}>
                {title.length} / 100
              </Text>
            }
          />
          <Input
            placeholder="例: ○○配信、誕生日会、オフ会"
            value={title}
            onChangeText={setTitle}
            maxLength={100}
          />
        </Card>

        {/* ───────── 説明 ───────── */}
        <Card>
          <SectionHeader
            title="説明"
            badge={{ kind: 'optional' }}
            right={
              <Text style={[T.caption, { color: description.length > 900 ? C.amber : C.text3 }]}>
                {description.length} / 1000
              </Text>
            }
          />
          <Input
            placeholder="内容・参加方法など"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={1000}
            textAlignVertical="top"
          />
        </Card>

        {/* ───────── 日時 ───────── */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon.calendar size={14} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.bodyB, { color: C.text, fontWeight: '700' }]}>日時</Text>
            <Badge kind="required" />
          </View>
          <Input
            label="開始"
            placeholder={DT_PLACEHOLDER}
            value={startsAt}
            onChangeText={setStartsAt}
            autoCapitalize="none"
            autoCorrect={false}
            error={
              startsAt.length > 0 && !startsDate
                ? '日時の形式が正しくありません'
                : undefined
            }
          />
          <Input
            label="終了 (任意)"
            placeholder={DT_PLACEHOLDER}
            value={endsAt}
            onChangeText={setEndsAt}
            autoCapitalize="none"
            autoCorrect={false}
            error={
              endsAt.length > 0 && !endsDate
                ? '日時の形式が正しくありません'
                : !endsAfterStarts
                  ? '終了は開始より後にしてください'
                  : undefined
            }
          />
          {Platform.OS === 'web' && (
            <Text style={[T.caption, { color: C.text3 }]}>
              ヒント: 半角で「2025-06-01T19:30」のように入力
            </Text>
          )}
          {/* 解釈プレビュー — valid な時だけ */}
          {startsDate && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                padding: SP['3'],
                backgroundColor: C.accentBg,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.accent + '55',
              }}
            >
              <Icon.check size={14} color={C.accent} strokeWidth={2.6} />
              <Text style={[T.small, { color: C.accent, fontWeight: '700', flex: 1 }]} numberOfLines={2}>
                {startsDate.toLocaleString('ja-JP')}
                {endsDate && endsAfterStarts ? `\n〜 ${endsDate.toLocaleString('ja-JP')}` : ''}
              </Text>
            </View>
          )}
        </Card>

        {/* ───────── 会場 (spot) ───────── */}
        <Card>
          <EventSpotPicker
            communityId={id}
            value={spotId}
            onChange={setSpotId}
          />
        </Card>

        {/* ───────── 場所 (テキスト補足) ───────── */}
        <Card>
          <SectionHeader
            title="場所 (テキスト)"
            badge={{ kind: 'optional' }}
            right={
              <Text style={[T.caption, { color: locationText.length > 180 ? C.amber : C.text3 }]}>
                {locationText.length} / 200
              </Text>
            }
          />
          <Text style={[T.caption, { color: C.text3 }]}>
            聖地と別に補足したい時 (例: A 棟 3F / オンライン)
          </Text>
          <Input
            icon={Icon.map}
            placeholder="補足情報"
            value={locationText}
            onChangeText={setLocationText}
            maxLength={200}
          />
        </Card>
      </ScrollView>

      {/* ───────── Sticky CTA — (tabs) 配下なので TabBar の上に出す ───────── */}
      <View
        style={{
          position: 'absolute',
          left: 0, right: 0,
          bottom: TABBAR.height + insets.bottom,
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: SP['3'],
          backgroundColor: C.bg,
          borderTopWidth: 1,
          borderTopColor: C.border,
          gap: SP['2'],
        }}
      >
        {!canSubmit && (
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            {title.trim().length === 0
              ? 'タイトルを入力してください'
              : !startsDate
                ? '開始日時を正しく入力してください'
                : !endsAfterStarts
                  ? '終了日時は開始より後にしてください'
                  : ''}
          </Text>
        )}
        <Button
          label={submitting ? '登録中…' : 'イベントを登録'}
          onPress={handleSubmit}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={submitting}
          haptic="confirm"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// ============================================================
// 小物コンポーネント (このファイル限定 — spot/create.tsx と統一)
// ============================================================

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
      }}
    >
      {children}
    </View>
  );
}

type BadgeKind = 'required' | 'optional' | 'recommended';

function SectionHeader({
  title,
  badge,
  right,
}: {
  title: string;
  badge?: { kind: BadgeKind };
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
      <Text style={[T.bodyB, { color: C.text, fontWeight: '700' }]}>{title}</Text>
      {badge && <Badge kind={badge.kind} />}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

function Badge({ kind }: { kind: BadgeKind }) {
  const meta = {
    required:    { label: '必須', fg: C.red,    bg: C.red + '22',    border: C.red + '44' },
    optional:    { label: '任意', fg: C.text3,  bg: C.bg3,           border: C.border },
    recommended: { label: '推奨', fg: C.accent, bg: C.accentBg,      border: C.accent + '55' },
  }[kind];
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: R.full,
        backgroundColor: meta.bg,
        borderWidth: 1,
        borderColor: meta.border,
      }}
    >
      <Text style={{ fontSize: 10, color: meta.fg, fontWeight: '700' }}>
        {meta.label}
      </Text>
    </View>
  );
}
