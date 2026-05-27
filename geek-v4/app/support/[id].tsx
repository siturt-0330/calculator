// ============================================================
// app/support/[id].tsx — Modmail スレッド詳細
// ============================================================
// レイアウト:
//   - TopBar: subject + state badge + 右側 archive ボタン (admin のみ)
//   - メッセージ一覧 (ScrollView, 古→新 ascending):
//       自分: 右寄せ accentBg
//       相手 (運営): 左寄せ GlassCard + shield icon
//   - 入力欄 + 送信ボタン (gradient) — KeyboardAvoidingView
//
// admin ↔ user 両方が同じ画面を共有。useIsAdmin() で asAdmin を切り替えるだけ。
// ============================================================
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useIsAdmin } from '../../hooks/useAdmin';
import { useSupportThread } from '../../hooks/useSupportThread';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SupportMessageBubble } from '../../components/support/SupportMessageBubble';
import { CATEGORY_META, STATE_META } from '../../lib/api/support';
import { Icon } from '../../constants/icons';
import { C, GRAD, R, SHADOW, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { LinearGradient } from 'expo-linear-gradient';

// state 表示用色
const STATE_COLORS: Record<'amber' | 'accent' | 'text3', { fg: string; bg: string; border: string }> = {
  amber: { fg: C.amber, bg: C.amberBg, border: C.amber + '55' },
  accent: { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  text3: { fg: C.text3, bg: C.bg3, border: C.border },
};

export default function SupportThreadScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const threadId = (params.id ?? '') as string;
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isAdmin = useIsAdmin();

  const {
    thread,
    messages,
    isLoading,
    send,
    sending,
    archive,
    archiving,
    reopen,
    reopening,
  } = useSupportThread(threadId, { asAdmin: isAdmin });

  const [input, setInput] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const stateMeta = thread ? STATE_META[thread.state] : null;
  const stateC = stateMeta ? STATE_COLORS[stateMeta.color] : null;
  const cat = thread ? CATEGORY_META[thread.category] : null;
  const isArchived = thread?.state === 'archived';

  // messages が増えたら最下部に scroll (新着到着 / 送信直後)
  useEffect(() => {
    if (messages.length === 0) return;
    // 描画完了後に scroll するため次フレーム待ち
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  const handleSend = async () => {
    const body = input.trim();
    if (!body || sending) return;
    setInput('');
    try {
      await send(body);
    } catch {
      // hook 側で toast 出るので caller では握りつぶす。送信失敗時は入力を戻す
      setInput(body);
    }
  };

  const handleArchive = async () => {
    setArchiveOpen(false);
    if (isArchived) {
      await reopen();
    } else {
      await archive();
    }
  };

  if (isLoading || !thread) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="お問い合わせ" left={<BackButton />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {isLoading ? (
            <Spinner />
          ) : (
            <Text style={[T.body, { color: C.text3 }]}>スレッドが見つかりません</Text>
          )}
        </View>
      </View>
    );
  }

  const canSend = input.trim().length > 0 && !sending && !isArchived;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title=""
        left={<BackButton />}
        right={
          isAdmin ? (
            <PressableScale
              onPress={() => setArchiveOpen(true)}
              haptic="tap"
              disabled={archiving || reopening}
              hitSlop={8}
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                borderRadius: R.full,
                backgroundColor: isArchived ? C.accentBg : C.bg3,
                borderWidth: 1,
                borderColor: isArchived ? C.accent + '55' : C.border,
              }}
            >
              <Text
                style={[
                  T.caption,
                  {
                    color: isArchived ? C.accentLight : C.text2,
                    fontWeight: '800',
                  },
                ]}
              >
                {isArchived ? '再オープン' : '解決済にする'}
              </Text>
            </PressableScale>
          ) : null
        }
      />

      {/* スレッドメタ (subject + category + state) */}
      <View
        style={{
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          gap: SP['2'],
        }}
      >
        <Text style={[T.h3, { color: C.text }]} numberOfLines={2}>
          {thread.subject}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
          {cat && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                borderRadius: R.full,
                backgroundColor: C.accentBg,
                borderWidth: 1,
                borderColor: C.accent + '44',
              }}
            >
              <Text style={{ fontSize: 11 }}>{cat.emoji}</Text>
              <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
                {cat.label}
              </Text>
            </View>
          )}
          {stateMeta && stateC && (
            <View
              style={{
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                borderRadius: R.sm,
                backgroundColor: stateC.bg,
                borderWidth: 1,
                borderColor: stateC.border,
              }}
            >
              <Text style={{ fontSize: 10, color: stateC.fg, fontWeight: '700' }}>
                {stateMeta.label}
              </Text>
            </View>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        {/* メッセージ一覧 */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: SP['4'],
            paddingTop: SP['3'],
            paddingBottom: SP['4'],
          }}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
              <Text style={[T.body, { color: C.text3 }]}>メッセージがありません</Text>
            </View>
          ) : (
            messages.map((m) => (
              <SupportMessageBubble key={m.id} message={m} own={m.author_id === currentUserId} />
            ))
          )}
        </ScrollView>

        {/* 入力欄 */}
        {isArchived ? (
          <View
            style={{
              paddingHorizontal: SP['4'],
              paddingTop: SP['3'],
              paddingBottom: insets.bottom + SP['3'],
              borderTopWidth: 1,
              borderTopColor: C.border,
              backgroundColor: C.bg2,
              alignItems: 'center',
            }}
          >
            <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
              このスレッドは解決済です。{isAdmin ? '再オープンすると返信可能になります。' : ''}
            </Text>
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: SP['2'],
              paddingHorizontal: SP['4'],
              paddingTop: SP['2'],
              paddingBottom: insets.bottom + SP['2'],
              borderTopWidth: 1,
              borderTopColor: C.border,
              backgroundColor: C.bg2,
            }}
          >
            <TextInput
              ref={inputRef}
              value={input}
              onChangeText={setInput}
              placeholder={isAdmin ? '運営として返信…' : 'メッセージを入力…'}
              placeholderTextColor={C.text3}
              multiline
              maxLength={2000}
              selectionColor={C.accent}
              cursorColor={C.accent}
              style={[
                T.body,
                {
                  flex: 1,
                  maxHeight: 120,
                  minHeight: 40,
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['2'],
                  borderRadius: R.lg,
                  backgroundColor: C.bg3,
                  color: C.text,
                  borderWidth: 1,
                  borderColor: C.border,
                },
              ]}
            />
            <PressableScale
              onPress={handleSend}
              disabled={!canSend}
              haptic="confirm"
              hitSlop={8}
              style={[
                {
                  width: 44,
                  height: 44,
                  borderRadius: R.full,
                  overflow: 'hidden',
                  opacity: canSend ? 1 : 0.4,
                },
                canSend ? SHADOW.glow : null,
              ]}
              accessibilityLabel="送信"
            >
              <LinearGradient
                colors={GRAD.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon.send size={18} color="#fff" strokeWidth={2.4} />
              </LinearGradient>
            </PressableScale>
          </View>
        )}
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={archiveOpen}
        title={isArchived ? '再オープンしますか？' : '解決済にしますか？'}
        message={
          isArchived
            ? 'スレッドを再開し、双方が返信できる状態にします。'
            : 'スレッドを解決済にし、新規返信を停止します。後から再オープンも可能です。'
        }
        confirmLabel={isArchived ? '再オープン' : '解決済にする'}
        cancelLabel="キャンセル"
        onCancel={() => setArchiveOpen(false)}
        onConfirm={handleArchive}
      />
    </View>
  );
}
