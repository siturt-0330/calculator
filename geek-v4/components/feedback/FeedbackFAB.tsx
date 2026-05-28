import { useCallback, useState } from 'react';
import { View, Text, Modal, TextInput, ActivityIndicator, Platform } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
import { useToastStore } from '../../stores/toastStore';
import { submitFeedback, type FeedbackKind } from '../../lib/api/feedback';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuthStore } from '../../stores/authStore';
import { useColors, useGradients, useShadows } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
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

// FAB 出現用 spring (指示通り damping 12 / stiffness 220 — ややバウンシー)
const FAB_ENTRY_SPRING = { damping: 12, stiffness: 220, mass: 0.7 } as const;
// press フィードバック (Apple Photos 系のキレ)
const FAB_PRESS_SPRING = { damping: 18, stiffness: 300, mass: 0.6 } as const;
const FAB_PRESS_SCALE = 0.92;

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

  // テーマ購読 (gradient / shadow の glow 強化用)
  const GRAD = useGradients();
  const SHADOW = useShadows();
  const reduceMotion = useReducedMotion();

  // FAB の scale (出現 + press の合算)
  const entryScale = useSharedValue(reduceMotion ? 1 : 0);
  const pressScale = useSharedValue(1);

  // route 変更で出現アニメを replay
  // useFocusEffect は callback が `() => cleanup | void` を返すのでこの形にする。
  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) {
        entryScale.value = 1;
        return;
      }
      // 直前に in-flight があれば停止してから再生 (route 連続変更の race を防ぐ)
      cancelAnimation(entryScale);
      entryScale.value = 0;
      entryScale.value = withSpring(1, FAB_ENTRY_SPRING);
      return () => {
        // unfocus 時は触らない (再 focus で replay する)
      };
      // intentionally bind to focus only
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reduceMotion]),
  );

  // press ハンドラ
  const onFabPressIn = () => {
    if (reduceMotion) return;
    pressScale.value = withSpring(FAB_PRESS_SCALE, FAB_PRESS_SPRING);
  };
  const onFabPressOut = () => {
    if (reduceMotion) return;
    pressScale.value = withSpring(1, FAB_PRESS_SPRING);
  };

  const fabAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: entryScale.value * pressScale.value }],
    opacity: entryScale.value,
  }));

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
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            right: SP['4'],
            bottom: insets.bottom + 90, // タブバーの上
            width: 46,
            height: 46,
            borderRadius: 23,
            zIndex: 1000,
            // 紫 glow 強化 — SHADOW.glow は色付きシャドウ (#7C6AF7)
            ...(SHADOW.glow as object),
            // web のみ: hover で halo 拡張 (touch device では無視される)
            ...(Platform.OS === 'web'
              ? ({ transition: 'box-shadow 220ms ease' } as Record<string, unknown>)
              : {}),
          },
          fabAnimStyle,
        ]}
      >
        <PressableScale
          onPress={() => setOpen(true)}
          onPressIn={onFabPressIn}
          onPressOut={onFabPressOut}
          haptic="tap"
          // PressableScale 側の scale animation は disable (こちらで合算するので二重に縮まない)
          scaleValue={1}
          accessibilityLabel="この画面についてのフィードバックを送る"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 23,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            // gradient が transparent border 越しに見えるよう、background は LinearGradient 任せ
            borderWidth: 1.5,
            borderColor: 'rgba(255,255,255,0.18)',
          }}
        >
          <LinearGradient
            colors={[...GRAD.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            }}
          />
          <Text style={{ fontSize: 18 }}>🔧</Text>
        </PressableScale>
      </Animated.View>

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
