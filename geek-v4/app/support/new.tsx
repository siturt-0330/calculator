// ============================================================
// app/support/new.tsx — 新規 Modmail 作成
// ============================================================
// レイアウト:
//   - TopBar 「新規問い合わせ」 + BackButton
//   - カテゴリ chip grid (6 種、accent 色 active)
//   - subject Input
//   - 本文 TextArea (maxLength 2000)
//   - 送信 PolishedButton (gradient + glow)
//   - validation: subject / category / 本文 必須
// ============================================================
import { useState } from 'react';
import { View, ScrollView, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Input } from '../../components/ui/Input';
import { TextArea } from '../../components/ui/TextArea';
import { PolishedButton } from '../../components/ui/PolishedButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { useCreateSupportThread } from '../../hooks/useSupportThreads';
import {
  CATEGORY_META,
  type SupportThreadCategory,
} from '../../lib/api/support';
import { useToastStore } from '../../stores/toastStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

const CATEGORIES: SupportThreadCategory[] = [
  'account_appeal',
  'rule_question',
  'community_question',
  'bug_report',
  'feature_request',
  'other',
];

export default function SupportNewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);
  const create = useCreateSupportThread();

  const [category, setCategory] = useState<SupportThreadCategory | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const canSubmit =
    category !== null &&
    subject.trim().length > 0 &&
    message.trim().length > 0 &&
    !create.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || category === null) return;
    try {
      const res = await create.mutateAsync({
        subject: subject.trim(),
        category,
        initialMessage: message.trim(),
      });
      showToast('問い合わせを送信しました', 'success');
      // 作成直後は詳細画面に遷移 (一覧 → 詳細 という stack を作るため replace ではなく push)
      router.replace(`/support/${res.thread.id}` as never);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      showToast(msg ? `送信失敗: ${msg}` : '送信に失敗しました', 'error');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="新規問い合わせ" left={<BackButton />} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: SP['4'],
            paddingTop: SP['4'],
            paddingBottom: insets.bottom + SP['10'],
            gap: SP['4'],
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* カテゴリ */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.small, { color: C.text2 }]}>
              カテゴリ <Text style={{ color: C.red }}>*</Text>
            </Text>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: SP['2'],
              }}
            >
              {CATEGORIES.map((c) => {
                const meta = CATEGORY_META[c];
                const active = category === c;
                return (
                  <PressableScale
                    key={c}
                    onPress={() => setCategory(c)}
                    haptic="select"
                    hitSlop={6}
                    style={{
                      flexBasis: '48%',
                      flexGrow: 1,
                      paddingVertical: SP['3'],
                      paddingHorizontal: SP['3'],
                      borderRadius: R.lg,
                      backgroundColor: active ? C.accentBg : C.bg2,
                      borderWidth: 1.5,
                      borderColor: active ? C.accent : C.border,
                      gap: 4,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: SP['1'],
                      }}
                    >
                      <Text style={{ fontSize: 16 }}>{meta.emoji}</Text>
                      <Text
                        style={[
                          T.smallM,
                          {
                            color: active ? C.accentLight : C.text,
                            fontWeight: '700',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {meta.label}
                      </Text>
                    </View>
                    <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                      {meta.description}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          {/* 件名 */}
          <Input
            label="件名 *"
            value={subject}
            onChangeText={setSubject}
            placeholder="例: BAN の理由を教えてください"
            maxLength={100}
            autoCapitalize="none"
          />

          {/* 本文 */}
          <View style={{ gap: SP['1'] }}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Text style={[T.small, { color: C.text2 }]}>
                本文 <Text style={{ color: C.red }}>*</Text>
              </Text>
              <Text style={[T.caption, { color: C.text3 }]}>{message.length} / 2000</Text>
            </View>
            <TextArea
              value={message}
              onChangeText={setMessage}
              placeholder="できるだけ具体的にお書きください。スクリーンショットや該当 URL があれば一緒に送ってください。"
              maxLength={2000}
              minHeight={160}
            />
          </View>

          {/* 送信 */}
          <View style={{ marginTop: SP['2'] }}>
            <PolishedButton
              variant="gradient"
              gradient="primary"
              label={create.isPending ? '送信中…' : '送信する'}
              onPress={handleSubmit}
              disabled={!canSubmit}
              loading={create.isPending}
              haptic="confirm"
              fullWidth
              size="lg"
            />
          </View>

          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            送信後、運営から返信があった際は通知が届きます。
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
