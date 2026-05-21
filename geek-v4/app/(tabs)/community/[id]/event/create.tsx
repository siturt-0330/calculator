// ============================================================
// イベント作成 (community event create)
// ネイティブ DateTimePicker を入れる前のシンプルな実装。
// 日時は ISO ローカル文字列 (YYYY-MM-DDTHH:MM) で入力。web では <input type="datetime-local">
// が出るのが理想だが、react-native の TextInput でも numeric/普通テキストで普通に打てる。
// 入力値は Date 化して有効性チェック → ISO で API へ。
// ============================================================
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
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

// "YYYY-MM-DDTHH:MM" な local datetime → Date
function parseLocalDateTime(s: string): Date | null {
  if (!s) return null;
  // datetime-local は秒抜き。安全に Date('YYYY-MM-DDTHH:MM') で local 解釈になる。
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 今を基準にした初期値 (datetime-local 形式)
function defaultStartsAt(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60 - d.getMinutes()); // 次の正時
  d.setSeconds(0);
  d.setMilliseconds(0);
  // toISOString は UTC なので、ローカルへ変換した文字列を組む
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

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
  const [submitting, setSubmitting] = useState(false);

  const startsDate = useMemo(() => parseLocalDateTime(startsAt), [startsAt]);
  const endsDate = useMemo(() => parseLocalDateTime(endsAt), [endsAt]);
  const endsAfterStarts = !endsDate || !startsDate || endsDate.getTime() > startsDate.getTime();
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

  // web 上では <input type="datetime-local"> な体験になるよう、underlying TextInput に
  // type 属性を渡すための data-* 経由は無理なので、ヒント文字列を placeholder に頼る。
  const dtPlaceholder = 'YYYY-MM-DDTHH:MM';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
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
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label="タイトル"
          placeholder="例: ○○配信、誕生日会、オフ会"
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />
        <Input
          label="説明 (任意)"
          placeholder="内容・参加方法など"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          maxLength={1000}
          textAlignVertical="top"
        />

        {/* 日時セクション */}
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon.calendar size={14} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.small, { color: C.text2, fontWeight: '700' }]}>日時</Text>
          </View>
          <Input
            label="開始"
            placeholder={dtPlaceholder}
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
            placeholder={dtPlaceholder}
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
              ヒント: 半角で 「2025-06-01T19:30」 のように入力します
            </Text>
          )}
          {/* 解釈プレビュー — 入力が valid なら人間に読める形で確認させる */}
          {startsDate && (
            <Pressable
              disabled
              style={{
                paddingVertical: SP['2'],
                paddingHorizontal: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={[T.caption, { color: C.text3 }]}>解釈</Text>
              <Text style={[T.small, { color: C.text, marginTop: 2 }]}>
                {startsDate.toLocaleString('ja-JP')}
                {endsDate && endsAfterStarts ? ` 〜 ${endsDate.toLocaleString('ja-JP')}` : ''}
              </Text>
            </Pressable>
          )}
        </View>

        <Input
          label="場所 (任意)"
          icon={Icon.map}
          placeholder="例: 渋谷ハチ公前 / Discord / オンライン"
          value={locationText}
          onChangeText={setLocationText}
          maxLength={200}
        />

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
      </ScrollView>
    </View>
  );
}
