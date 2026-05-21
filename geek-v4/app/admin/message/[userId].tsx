import { useMemo, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { Avatar } from '../../../components/ui/Avatar';
import { Input } from '../../../components/ui/Input';
import { TextArea } from '../../../components/ui/TextArea';
import { Button } from '../../../components/ui/Button';
import { Spinner } from '../../../components/ui/Spinner';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon } from '../../../constants/icons';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { useToastStore } from '../../../stores/toastStore';
import { formatRelative } from '../../../lib/utils/date';
import {
  fetchUserDetail,
  sendAdminMessage,
  type AdminMessage,
} from '../../../lib/api/admin';

// ============================================================
// DM 送信 (admin) — /admin/message/[userId]
// ============================================================
// admin → 単一 user に DM を送るフォーム。
//   - タイトル 1-120 / 本文 1-4000 のクライアント側検証 (DB の check 制約と一致)
//   - sendAdminMessage 成功で toast + router.back()
//   - 受信者の nickname / avatar をフォーム上部に表示
//   - フォーム下にこのユーザーへの過去 DM を時系列で表示
// ============================================================

const TITLE_MAX = 120;
const BODY_MAX = 4000;

export default function AdminMessageScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { show } = useToastStore();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);

  // 宛先情報 + 過去 DM。 fetchUserDetail が messages も返してくれるので 1 リクエストで済む。
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-user-detail', userId],
    queryFn: () => fetchUserDetail(userId),
    enabled: !!userId,
    staleTime: 30_000,
  });

  // 送信ボタンの有効化条件 — trim 後の長さで判定 (前後空白だけの入力を弾く)
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
      sendAdminMessage({ recipientId: userId, title: trimmedTitle, body: trimmedBody }),
    onSuccess: () => {
      show('DM を送信しました', 'success');
      // 受信者の messages キャッシュを更新 (フォーム下の履歴がすぐ反映される)
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

  const recipient = data?.user;
  const history = data?.messages ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="DM を送る" left={<BackButton />} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Spinner />
          </View>
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
          <ScrollView
            contentContainerStyle={{
              padding: SP['4'],
              paddingBottom: insets.bottom + SP['10'],
              gap: SP['4'],
            }}
            keyboardShouldPersistTaps="handled"
          >
            {/* 宛先 */}
            <RecipientRow
              nickname={recipient?.nickname ?? null}
              userId={userId}
            />

            {/* タイトル */}
            <View style={{ gap: SP['1'] }}>
              <Input
                label="タイトル *"
                value={title}
                onChangeText={setTitle}
                maxLength={TITLE_MAX}
                placeholder="例: ガイドラインのご案内"
                {...(titleError !== undefined ? { error: titleError } : {})}
              />
              <CharCount value={trimmedTitle.length} max={TITLE_MAX} />
            </View>

            {/* 本文 */}
            <View style={{ gap: SP['1'] }}>
              <TextArea
                label="本文 *"
                value={body}
                onChangeText={setBody}
                maxLength={BODY_MAX}
                minHeight={200}
                placeholder="運営からのお知らせを書いてください。改行も可能です。"
                {...(bodyError !== undefined ? { error: bodyError } : {})}
              />
              <CharCount value={trimmedBody.length} max={BODY_MAX} />
            </View>

            {/* アクション */}
            <View style={{ flexDirection: 'row', gap: SP['2'], marginTop: SP['1'] }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="キャンセル"
                  onPress={() => router.back()}
                  variant="ghost"
                  size="lg"
                  fullWidth
                  haptic="tap"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={send.isPending ? '送信中…' : '送信'}
                  onPress={onSubmit}
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={send.isPending}
                  disabled={!canSubmit}
                  haptic="confirm"
                />
              </View>
            </View>

            {/* 過去の DM 履歴 */}
            <HistoryBlock history={history} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ============================================================
// 宛先表示
// ============================================================
function RecipientRow({ nickname, userId }: { nickname: string | null; userId: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
      }}
    >
      <Avatar size={36} name={nickname ?? undefined} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.caption, { color: C.text3, letterSpacing: 0.6 }]}>宛先</Text>
        <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
          {nickname ?? '(unknown)'}
        </Text>
        <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
          {userId}
        </Text>
      </View>
    </View>
  );
}

// ============================================================
// 文字数カウンタ — limit 近づいたら色を変えて警告
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
        },
      ]}
    >
      {value} / {max}
    </Text>
  );
}

// ============================================================
// 過去の DM 履歴
// ============================================================
function HistoryBlock({ history }: { history: AdminMessage[] }) {
  return (
    <View style={{ gap: SP['2'], marginTop: SP['4'] }}>
      <Text
        style={[
          T.smallB,
          {
            color: C.text3,
            paddingHorizontal: SP['1'],
            letterSpacing: 0.6,
            fontSize: 11,
          },
        ]}
      >
        {`このユーザーへの過去 DM (${history.length})`.toUpperCase()}
      </Text>
      {history.length === 0 ? (
        <Text style={[T.small, { color: C.text3, paddingHorizontal: SP['1'] }]}>
          まだ送信履歴はありません。
        </Text>
      ) : (
        <View style={{ gap: SP['2'] }}>
          {history.map((m) => (
            <View
              key={m.id}
              style={{
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                gap: SP['1'],
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <Text style={[T.bodyB, { color: C.text, flex: 1 }]} numberOfLines={1}>
                  {m.title}
                </Text>
                {m.read_at ? (
                  <Text style={[T.caption, { color: C.green }]}>既読</Text>
                ) : (
                  <Text style={[T.caption, { color: C.amber }]}>未読</Text>
                )}
                <Text style={[T.caption, { color: C.text4 }]}>
                  {formatRelative(m.created_at)}
                </Text>
              </View>
              <Text style={[T.small, { color: C.text2 }]} numberOfLines={3}>
                {m.body}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
