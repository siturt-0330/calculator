import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BackButton } from '../../components/nav/BackButton';
import { Icon } from '../../constants/icons';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import { StepProgress } from './_progress';

export default function NicknameScreen() {
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const UserIcon = Icon.mypage;
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { show } = useToastStore();

  useEffect(() => {
    if (user?.nickname) setNickname(user.nickname);
  }, [user?.nickname]);

  // 2 - 20 文字以外なら error message を出す (空のまま放置されているときは出さない)
  // 注: 絵文字 / CJK は JS の .length が code unit ベースなので grapheme cluster
  // で数える必要がある (DB の length() は code point カウント、UI も grapheme で数える)
  const trimmed = nickname.trim();
  // Array.from で iterator を経由すると code point ベースになる (絵文字 sequence
  // は正しく扱えないが、一般的な日本語 / 英語は code point = grapheme で OK)
  const charCount = Array.from(trimmed).length;
  const tooShort = touched && charCount > 0 && charCount < 2;
  const tooLong = charCount > 20;
  const canSubmit = charCount >= 2 && charCount <= 20 && !saving;

  const next = async () => {
    if (!canSubmit) {
      setTouched(true);
      if (charCount < 2) {
        show('ニックネームは 2 文字以上にしてください。', 'warn');
      } else if (charCount > 20) {
        show('ニックネームは 20 文字以内にしてください。', 'warn');
      }
      return;
    }
    if (!user) {
      // ユーザー未取得でもオンボーディングは進める (notifications.tsx で fallback)
      router.replace('/onboarding/liked-tags');
      return;
    }

    setSaving(true);
    // 即時にローカルストアを楽観的更新 — DB 応答を待たずに UX を進めるため
    // (この段階で nickname を反映しておくと、次画面以降で古い値が見えない)
    setUser({ ...user, nickname: trimmed });

    // 3 秒タイムアウト付きで upsert — 何があっても 3 秒で UI を解放
    // 失敗・タイムアウト時も notifications.tsx の最終 upsert で fallback されるので
    // ここで止める必要は無い (進めるのが最優先)
    type UpsertResult = { kind: 'ok' } | { kind: 'error'; message: string } | { kind: 'timeout' };
    const upsertWithTimeout = (): Promise<UpsertResult> =>
      Promise.race<UpsertResult>([
        (async () => {
          try {
            const { error } = await supabase
              .from('profiles')
              .upsert({ id: user.id, nickname: trimmed })
              .select();
            if (error) return { kind: 'error', message: error.message };
            return { kind: 'ok' };
          } catch (e) {
            return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
          }
        })(),
        new Promise<UpsertResult>((resolve) =>
          setTimeout(() => resolve({ kind: 'timeout' }), 3000),
        ),
      ]);

    const result = await upsertWithTimeout();
    // どんな結果でも saving は必ず解除する (詰まり防止)
    setSaving(false);

    if (result.kind === 'error') {
      console.warn('[nickname] profile upsert failed:', result.message);
      const msg = result.message.toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) {
        // 重複は確実なクライアントエラー → 進めずに修正させる
        show('このニックネームは既に使用されています。別の名前を入力してください。', 'error');
        return;
      }
      if (msg.includes('check') || msg.includes('violates')) {
        // CHECK 違反も確実なクライアントエラー → 進めず修正させる
        show('使用できない文字が含まれています。', 'error');
        return;
      }
      // ネットワーク / 一時障害 → 進める (最終 upsert で再試行される)
      show('保存に失敗しましたが続行します。あとから設定で変更できます。', 'warn');
    } else if (result.kind === 'timeout') {
      // 3 秒以内に返らなかった → 進める方を優先 (UI を絶対詰まらせない)
      // 保存自体は内部で続行されている可能性があるので、エラー扱いにはしない
      console.warn('[nickname] upsert timeout (>3s) — proceeding anyway');
      show('通信が遅いため後で保存します。続行します。', 'warn');
    }

    router.replace('/onboarding/liked-tags');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['6'],
          paddingBottom: insets.bottom + SP['6'],
          gap: SP['6'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <BackButton />
          <StepProgress step={2} />
        </View>
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>ニックネームを決めよう</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            匿名投稿時は表示されません。自分だけに見えます。
          </Text>
        </View>
        <View style={{ gap: SP['2'] }}>
          <Input
            label="ニックネーム（2〜20文字）"
            icon={UserIcon}
            value={nickname}
            onChangeText={(v) => {
              setNickname(v);
              if (!touched) setTouched(true);
            }}
            placeholder="例: ぽけオタク"
            maxLength={20}
            autoFocus
            // 改行キー → 次へを直接発火させて 1 タップで進めるようにする
            returnKeyType="next"
            onSubmitEditing={() => { void next(); }}
            keyboardAppearance="dark"
            selectionColor={C.accent}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP['1'] }}>
            {/* 警告メッセージ — 文字数が範囲外のときだけ左に出す */}
            {tooShort ? (
              <Text style={[T.caption, { color: C.amber }]}>
                あと {2 - charCount} 文字以上必要です
              </Text>
            ) : tooLong ? (
              <Text style={[T.caption, { color: C.amber }]}>
                20 文字までにしてください
              </Text>
            ) : (
              // spacer — 右側の文字カウンタを常に右端に固定する
              <View />
            )}
            <Text style={[T.caption, {
              color: charCount > 20 ? C.amber : charCount >= 2 ? C.text2 : C.text3,
              fontVariant: ['tabular-nums'],
            }]}>
              {charCount}/20
            </Text>
          </View>
        </View>
        <View style={{ flex: 1 }} />
        <Button
          label="次へ"
          onPress={next}
          loading={saving}
          disabled={!canSubmit}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
