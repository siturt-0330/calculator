import { useState } from 'react';
import { View, Text, Modal, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
import { useToastStore } from '../../stores/toastStore';
import { submitFeedback, type FeedbackKind } from '../../lib/api/feedback';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuthStore } from '../../stores/authStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useT } from '../../lib/i18n';

const KIND_OPTIONS: { kind: FeedbackKind; label: string; emoji: string }[] = [
  { kind: 'ui',         label: 'UIが変',          emoji: '🎨' },
  { kind: 'bug',        label: 'バグ・エラー',     emoji: '🐞' },
  { kind: 'typo',       label: '誤字・誤表記',     emoji: '✏️' },
  { kind: 'suggestion', label: '機能の提案',       emoji: '💡' },
  { kind: 'content',    label: 'コンテンツの問題', emoji: '🚫' },
  { kind: 'other',      label: 'その他',           emoji: '💬' },
];

export function FeedbackFAB() {
  const t = useT();
  const enabled = useFeatureFlag('feedback_fab');
  const user = useAuthStore((s) => s.user);
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  // toast action のみ subscribe
  const show = useToastStore((s) => s.show);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('ui');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!enabled || !user) return null;

  const route = '/' + (segments || []).join('/');

  const handleSubmit = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    try {
      await submitFeedback({ kind, message, route });
      show('フィードバックを送信しました。ありがとう！', 'success');
      setMessage('');
      setKind('ui');
      setOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '送信に失敗しました';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        haptic="tap"
        accessibilityLabel="この画面についてのフィードバックを送る"
        style={{
          position: 'absolute',
          right: SP['4'],
          bottom: insets.bottom + 90,  // タブバーの上
          width: 46, height: 46,
          borderRadius: 23,
          backgroundColor: C.bg2,
          borderWidth: 1.5,
          borderColor: C.border,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
          zIndex: 1000,
        }}
      >
        <Text style={{ fontSize: 18 }}>🔧</Text>
      </PressableScale>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: C.bg2,
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['4'],
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1, borderColor: C.border,
            gap: SP['3'],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={{ fontSize: 20 }}>🔧</Text>
              <Text style={[T.h3, { color: C.text, flex: 1 }]}>
                {t('ここを修正したい')}
              </Text>
              <PressableScale
                onPress={() => setOpen(false)}
                haptic="tap"
                hitSlop={12}
                accessibilityLabel="閉じる"
                style={{ padding: SP['2'] }}
              >
                <Text style={{ fontSize: 18, color: C.text3 }}>✕</Text>
              </PressableScale>
            </View>

            <Text style={[T.caption, { color: C.text3 }]}>
              いま開いている画面: <Text style={{ color: C.accent }}>{route || '/'}</Text>
            </Text>

            {/* カテゴリ選択 */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {KIND_OPTIONS.map((opt) => {
                const active = kind === opt.kind;
                return (
                  <PressableScale
                    key={opt.kind}
                    onPress={() => setKind(opt.kind)}
                    haptic="select"
                    style={{
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['2'],
                      borderRadius: R.full,
                      backgroundColor: active ? C.accent : C.bg3,
                      borderWidth: 1.5,
                      borderColor: active ? C.accent : C.border,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>{opt.emoji}</Text>
                    <Text style={[T.smallM, { color: active ? '#fff' : C.text, fontWeight: '700' }]}>
                      {t(opt.label)}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>

            {/* 入力 */}
            <View style={{
              backgroundColor: C.bg3,
              borderRadius: R.md,
              borderWidth: 1, borderColor: message.trim() ? C.accent : C.border,
              padding: SP['3'],
              gap: SP['1'],
            }}>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder="どこをどう直したいか、具体的に教えてください
例: 投稿カードの右上のボタンが小さくて押しにくい"
                placeholderTextColor={C.text3}
                multiline
                maxLength={2000}
                style={[T.body, { color: C.text, minHeight: 90, maxHeight: 200 }]}
              />
              <Text style={{ fontSize: 10, color: message.length > 1800 ? C.amber : C.text3, textAlign: 'right' }}>
                {message.length} / 2000
              </Text>
            </View>

            {/* 送信 */}
            <PressableScale
              onPress={handleSubmit}
              disabled={!message.trim() || submitting}
              haptic="confirm"
              style={{
                alignItems: 'center',
                paddingVertical: SP['3'],
                backgroundColor: message.trim() && !submitting ? C.accent : C.bg4,
                borderRadius: R.md,
              }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[T.bodyB, { color: '#fff' }]}>
                  {t('フィードバックを送信')}
                </Text>
              )}
            </PressableScale>

            <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
              {Platform.OS === 'web' ? '画面サイズと URL は自動で添付されます' : 'デバイス情報は自動で添付されます'}
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}
