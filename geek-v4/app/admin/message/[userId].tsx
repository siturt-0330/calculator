import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Avatar } from '../../../components/ui/Avatar';
import { Input } from '../../../components/ui/Input';
import { TextArea } from '../../../components/ui/TextArea';
import { Skeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon } from '../../../constants/icons';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { useToastStore } from '../../../stores/toastStore';
import { formatRelative } from '../../../lib/utils/date';
import {
  fetchUserDetail,
  sendAdminMessage,
  type AdminMessage,
  type AdminUser,
} from '../../../lib/api/admin';

// ============================================================
// DM 送信 (admin) — /admin/message/[userId]
// ============================================================
// Chat-style DM composer with rich recipient context.
//   - Recipient context card (tap → /admin/user/[userId])
//   - Past DMs as chat bubbles (admin-right, accent)
//   - Quick template chips
//   - Title + body with live char counters (amber near, red over limit)
//   - Send button (KeyboardAvoidingView wraps)
// ============================================================

const TITLE_MAX = 120;
const BODY_MAX = 4000;

// account_state → 表示メタ
const STATE_META: Record<string, { label: string; color: string }> = {
  healthy:    { label: '正常',   color: C.green },
  caution:    { label: '注意',   color: C.amber },
  restricted: { label: '制限中', color: '#FF8A3D' },
  warned:     { label: '警告中', color: C.red },
  suspended:  { label: '凍結中', color: '#FF4D4D' },
  banned:     { label: 'BAN',    color: C.red },
};

type Template = { key: string; label: string; title: string; body: string };

const TEMPLATES: Template[] = [
  {
    key: 'warn',
    label: '警告',
    title: '【警告】ご利用について',
    body:
      'いつもご利用ありがとうございます。\n運営より、あなたの最近のアクティビティに関して警告をお伝えします。コミュニティガイドラインを今一度ご確認ください。',
  },
  {
    key: 'rule',
    label: 'ルール違反のお知らせ',
    title: 'ルール違反に関するご連絡',
    body:
      'あなたの投稿がコミュニティガイドラインに違反していると判断されました。該当投稿は削除させていただいた場合があります。詳細はガイドラインをご確認ください。',
  },
  {
    key: 'ban',
    label: 'BAN通知',
    title: '【重要】アカウント停止のお知らせ',
    body:
      '繰り返しガイドラインへの違反が確認されたため、運営の判断によりアカウントを停止しました。\nご質問はお問い合わせフォームよりご連絡ください。',
  },
  {
    key: 'reply',
    label: 'お問い合わせへの返信',
    title: 'お問い合わせの件について',
    body:
      'お問い合わせいただきありがとうございます。\n以下、ご質問に対する運営からの回答です。\n\n',
  },
];

export default function AdminMessageScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-user-detail', userId],
    queryFn: () => fetchUserDetail(userId),
    enabled: !!userId,
    staleTime: 30_000,
  });

  // 送信ボタンの有効化条件
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const titleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= TITLE_MAX;
  const bodyValid = trimmedBody.length >= 1 && trimmedBody.length <= BODY_MAX;
  const canSubmit = titleValid && bodyValid;

  const titleError =
    touched && !titleValid
      ? trimmedTitle.length === 0
        ? 'タイトルを入力してください'
        : `${TITLE_MAX} 文字以内で入力してください`
      : undefined;
  const bodyError =
    touched && !bodyValid
      ? trimmedBody.length === 0
        ? '本文を入力してください'
        : `${BODY_MAX} 文字以内で入力してください`
      : undefined;

  const send = useMutation({
    mutationFn: () =>
      sendAdminMessage({
        recipientId: userId,
        title: trimmedTitle,
        body: trimmedBody,
      }),
    onSuccess: () => {
      show('DM を送信しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
      void qc.invalidateQueries({ queryKey: ['admin-messages'] });
      router.back();
    },
    onError: () => show('送信に失敗しました', 'error'),
  });

  const onSubmit = () => {
    setTouched(true);
    if (!canSubmit || send.isPending) return;
    send.mutate();
  };

  const applyTemplate = (tpl: Template) => {
    setTitle(tpl.title);
    setBody(tpl.body);
  };

  const recipient = data?.user;
  const history = data?.messages ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="運営メッセージ"
        left={<BackButton />}
        right={
          recipient ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 4,
                paddingRight: SP['2'],
                paddingVertical: 3,
                borderRadius: R.full,
                backgroundColor: C.bg3,
                borderWidth: 1,
                borderColor: C.border,
                maxWidth: 160,
              }}
            >
              <Avatar size={18} name={recipient.nickname ?? undefined} />
              <Text
                style={[T.caption, { color: C.text, flexShrink: 1 }]}
                numberOfLines={1}
              >
                {recipient.nickname ?? '(unknown)'}
              </Text>
            </View>
          ) : null
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {isLoading ? (
          <LoadingState />
        ) : error || !data ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon={Icon.warn}
              title="宛先を取得できませんでした"
              message="ユーザーが見つからないか、ネットワークエラーの可能性があります。"
              tone="amber"
            />
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={{
                padding: SP['4'],
                paddingBottom: insets.bottom + 96 + SP['6'],
                gap: SP['4'],
              }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Animated.View entering={FadeInDown.duration(280).delay(20)}>
                <RecipientCard
                  user={recipient ?? null}
                  userId={userId}
                  onPress={() =>
                    router.push(`/admin/user/${userId}` as never)
                  }
                />
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(280).delay(60)}>
                <HistoryBlock history={history} />
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(280).delay(100)}>
                <TemplateChips onPick={applyTemplate} />
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(280).delay(140)}>
                <ComposeForm
                  title={title}
                  body={body}
                  onTitle={setTitle}
                  onBody={setBody}
                  titleError={titleError}
                  bodyError={bodyError}
                  trimmedTitleLen={trimmedTitle.length}
                  trimmedBodyLen={trimmedBody.length}
                />
              </Animated.View>
            </ScrollView>

            <SendBar
              insetBottom={insets.bottom}
              loading={send.isPending}
              disabled={!canSubmit || send.isPending}
              onSend={onSubmit}
            />
          </>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ============================================================
// Loading skeleton
// ============================================================
function LoadingState() {
  return (
    <ScrollView
      contentContainerStyle={{ padding: SP['4'], gap: SP['4'] }}
      showsVerticalScrollIndicator={false}
    >
      <Skeleton height={96} radius={R.lg} />
      <Skeleton height={140} radius={R.lg} />
      <Skeleton height={60} radius={R.lg} />
      <Skeleton height={220} radius={R.lg} />
    </ScrollView>
  );
}

// ============================================================
// Recipient context card
// ============================================================
function RecipientCard({
  user,
  userId,
  onPress,
}: {
  user: AdminUser | null;
  userId: string;
  onPress: () => void;
}) {
  const stateMeta =
    user?.account_state
      ? STATE_META[user.account_state] ?? { label: user.account_state, color: C.text3 }
      : null;
  const ChevronR = Icon.chevronR;

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
        ...SHADOW.card,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <Avatar size={48} name={user?.nickname ?? undefined} />
        <View style={{ flex: 1, gap: 4 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}
          >
            <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
              {user?.nickname ?? '(unknown)'}
            </Text>
            {stateMeta ? (
              <View
                style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: 2,
                  borderRadius: R.full,
                  backgroundColor: stateMeta.color + '22',
                  borderWidth: 1,
                  borderColor: stateMeta.color + '55',
                }}
              >
                <Text
                  style={{ fontSize: 11, color: stateMeta.color, fontWeight: '700' }}
                >
                  {stateMeta.label}
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            style={[T.mono, { color: C.text4, fontSize: 11 }]}
            numberOfLines={1}
          >
            {userId}
          </Text>
        </View>
        <ChevronR size={16} color={C.text4} strokeWidth={2.2} />
      </View>

      {/* stats row */}
      {user ? (
        <View
          style={{
            flexDirection: 'row',
            gap: SP['2'],
            paddingTop: SP['3'],
            borderTopWidth: 1,
            borderTopColor: C.divider,
          }}
        >
          <MiniStat label="投稿数" value={user.post_count} />
          <StatDivider />
          <MiniStat
            label="通報受信"
            value={user.concern_received_count}
            accent={user.concern_received_count > 0 ? C.red : undefined}
          />
          <StatDivider />
          <MiniStat label="登録日" text={formatRelative(user.created_at)} />
        </View>
      ) : null}
    </PressableScale>
  );
}

function MiniStat({
  label,
  value,
  text,
  accent,
}: {
  label: string;
  value?: number;
  text?: string;
  accent?: string;
}) {
  const formatted = useMemo(
    () => (typeof value === 'number' ? value.toLocaleString('ja-JP') : text ?? ''),
    [value, text],
  );
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text
        style={[T.smallB, { color: accent ?? C.text, fontWeight: '700', fontSize: 14 }]}
        numberOfLines={1}
      >
        {formatted}
      </Text>
      <Text style={[T.caption, { color: C.text3, fontSize: 11 }]}>{label}</Text>
    </View>
  );
}

function StatDivider() {
  return <View style={{ width: 1, backgroundColor: C.divider }} />;
}

// ============================================================
// Quick template chips
// ============================================================
function TemplateChips({ onPick }: { onPick: (tpl: Template) => void }) {
  return (
    <View style={{ gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Icon.sparkles size={14} color={C.accentLight} strokeWidth={2.4} />
        <Text style={[T.smallB, { color: C.text2, letterSpacing: 0.4 }]}>
          クイックテンプレート
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: SP['2'], paddingRight: SP['2'] }}
      >
        {TEMPLATES.map((tpl) => (
          <PressableScale
            key={tpl.key}
            onPress={() => onPick(tpl)}
            haptic="tap"
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'],
              backgroundColor: C.accentSoft,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.accent + '55',
            }}
          >
            <Text style={[T.smallB, { color: C.accentLight, fontSize: 12 }]}>
              {tpl.label}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================
// Compose form
// ============================================================
function ComposeForm({
  title,
  body,
  onTitle,
  onBody,
  titleError,
  bodyError,
  trimmedTitleLen,
  trimmedBodyLen,
}: {
  title: string;
  body: string;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  titleError: string | undefined;
  bodyError: string | undefined;
  trimmedTitleLen: number;
  trimmedBodyLen: number;
}) {
  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
        ...SHADOW.card,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Icon.edit size={14} color={C.text2} strokeWidth={2.4} />
        <Text style={[T.smallB, { color: C.text2, letterSpacing: 0.4 }]}>
          メッセージ作成
        </Text>
      </View>

      {/* title */}
      <View style={{ gap: 4 }}>
        <Input
          label="タイトル *"
          value={title}
          onChangeText={onTitle}
          maxLength={TITLE_MAX}
          placeholder="例: ガイドラインのご案内"
          {...(titleError !== undefined ? { error: titleError } : {})}
        />
        <CharCount value={trimmedTitleLen} max={TITLE_MAX} />
      </View>

      {/* body */}
      <View style={{ gap: 4 }}>
        <TextArea
          label="本文 *"
          value={body}
          onChangeText={onBody}
          maxLength={BODY_MAX}
          minHeight={200}
          placeholder="運営からのお知らせを書いてください。改行も可能です。"
          {...(bodyError !== undefined ? { error: bodyError } : {})}
        />
        <CharCount value={trimmedBodyLen} max={BODY_MAX} />
      </View>
    </View>
  );
}

// ============================================================
// Char count
// ============================================================
function CharCount({ value, max }: { value: number; max: number }) {
  const ratio = value / max;
  const color = useMemo(() => {
    if (ratio >= 1) return C.red;
    if (ratio >= 0.9) return C.amber;
    return C.text4;
  }, [ratio]);
  return (
    <Text
      style={[
        T.caption,
        {
          color,
          textAlign: 'right',
          paddingHorizontal: SP['1'],
          fontVariant: ['tabular-nums'],
        },
      ]}
    >
      {value} / {max}
    </Text>
  );
}

// ============================================================
// Past DMs — chat bubble preview
// ============================================================
function HistoryBlock({ history }: { history: AdminMessage[] }) {
  const total = history.length;
  // most-recent first → flip to chronological (oldest top, newest bottom)
  const ordered = useMemo(() => [...history].reverse(), [history]);

  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
        ...SHADOW.card,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Icon.send size={14} color={C.text2} strokeWidth={2.4} />
        <Text style={[T.smallB, { color: C.text2, letterSpacing: 0.4 }]}>
          過去の運営DM ({total})
        </Text>
      </View>

      {total === 0 ? (
        <View
          style={{
            paddingVertical: SP['5'],
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon.send size={20} color={C.text4} strokeWidth={2} />
          <Text style={[T.small, { color: C.text3 }]}>
            まだメッセージを送っていません
          </Text>
        </View>
      ) : (
        <View style={{ gap: SP['3'] }}>
          {ordered.map((m) => (
            <ChatBubble key={m.id} msg={m} />
          ))}
        </View>
      )}
    </View>
  );
}

function ChatBubble({ msg }: { msg: AdminMessage }) {
  // Admin-sent → right-aligned, accent
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={{ flexDirection: 'row', justifyContent: 'flex-end' }}
    >
      <View style={{ maxWidth: '88%', alignItems: 'flex-end', gap: 4 }}>
        <View
          style={{
            paddingHorizontal: SP['3'],
            paddingVertical: SP['3'],
            backgroundColor: C.accent,
            borderRadius: R.lg,
            borderBottomRightRadius: 4,
            gap: 4,
            ...SHADOW.accentGlow,
          }}
        >
          <Text
            style={[T.smallB, { color: '#fff', fontWeight: '700' }]}
            numberOfLines={2}
          >
            {msg.title}
          </Text>
          <Text style={[T.small, { color: '#fff', lineHeight: 18 }]} numberOfLines={6}>
            {msg.body}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 4,
          }}
        >
          {msg.read_at ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: R.full,
                backgroundColor: C.greenBg,
                borderWidth: 1,
                borderColor: C.green + '55',
              }}
            >
              <Text style={{ fontSize: 11, color: C.green, fontWeight: '700' }}>
                既読
              </Text>
            </View>
          ) : (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: R.full,
                backgroundColor: C.amberBg,
                borderWidth: 1,
                borderColor: C.amber + '55',
              }}
            >
              <Text style={{ fontSize: 11, color: C.amber, fontWeight: '700' }}>
                未読
              </Text>
            </View>
          )}
          <Text style={[T.caption, { color: C.text4, fontSize: 11 }]}>
            {formatRelative(msg.created_at)}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ============================================================
// Sticky send bar
// ============================================================
function SendBar({
  insetBottom,
  loading,
  disabled,
  onSend,
}: {
  insetBottom: number;
  loading: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: SP['4'],
        paddingTop: SP['3'],
        paddingBottom: Math.max(insetBottom, SP['3']),
        backgroundColor: C.bg + 'F2',
        borderTopWidth: 1,
        borderTopColor: C.border,
        ...SHADOW.card,
      }}
    >
      <PressableScale
        onPress={onSend}
        haptic="confirm"
        disabled={disabled}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SP['2'],
          paddingVertical: SP['4'],
          backgroundColor: disabled ? C.bg3 : C.accent,
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: disabled ? C.border : C.accentDeep,
          opacity: disabled ? 0.6 : 1,
          ...(disabled ? {} : SHADOW.accentGlow),
        }}
      >
        <Icon.send size={18} color={disabled ? C.text3 : '#fff'} strokeWidth={2.4} />
        <Text
          style={[
            T.bodyB,
            { color: disabled ? C.text3 : '#fff', fontWeight: '700' },
          ]}
        >
          {loading ? '送信中…' : 'DMを送信'}
        </Text>
      </PressableScale>
    </View>
  );
}
