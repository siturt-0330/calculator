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
  const { user, setUser } = useAuthStore();
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
    if (user) {
      setSaving(true);
      try {
        // upsert 結果を確認 — RLS / trigger / 接続エラー全てに対応
        const { error } = await supabase
          .from('profiles')
          .upsert({ id: user.id, nickname: trimmed })
          .select();
        if (error) {
          console.warn('[nickname] profile upsert failed:', error.message);
          // 重複ニックネーム or CHECK 違反 → 明確にエラー表示してブロック
          // 一方、ネットワーク系エラーは続行 (notifications.tsx で fallback insert)
          const msg = error.message.toLowerCase();
          if (msg.includes('duplicate') || msg.includes('unique')) {
            show('このニックネームは既に使用されています。別の名前を入力してください。', 'error');
            setSaving(false);
            return;
          }
          if (msg.includes('check') || msg.includes('violates')) {
            show('使用できない文字が含まれています。', 'error');
            setSaving(false);
            return;
          }
          // それ以外 (ネットワーク等) は警告して進める
          show('ニックネームの保存に失敗しましたが、続行します。', 'warn');
        } else {
          // ローカルストアも即時更新 — マイページ等で古いニックネームが見えるのを防ぐ
          setUser({ ...user, nickname: trimmed });
        }
      } catch (e) {
        console.warn('[nickname] upsert exception:', e);
        show('ネットワークエラー。続行します。', 'warn');
      } finally {
        setSaving(false);
      }
    }
    router.push('/onboarding/liked-tags');
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
