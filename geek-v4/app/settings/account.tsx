import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { downloadUserDataAsJson, deleteAccount } from '../../lib/api/account';
import { supabase } from '../../lib/supabase';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const showToast = useToastStore((s) => s.show);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 再認証フェーズ — 不可逆操作なのでパスワード再入力を必須にする
  const [reAuthOpen, setReAuthOpen] = useState(false);
  const [reAuthPwd, setReAuthPwd] = useState('');
  const [reAuthing, setReAuthing] = useState(false);

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const r = await downloadUserDataAsJson();
      if (r.ok) {
        const kb = (r.bytes / 1024).toFixed(1);
        showToast(`データを書き出しました (${kb} KB)`, 'success');
      } else {
        showToast('書き出しに失敗しました', 'error');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '書き出しに失敗しました';
      showToast(msg, 'error');
    } finally {
      setExporting(false);
    }
  };

  // 第 1 ステップ: 警告ダイアログ で OK → 第 2 ステップ: パスワード再入力
  const onConfirmDelete = () => {
    setConfirmDelete(false);
    setReAuthPwd('');
    setReAuthOpen(true);
  };

  // 第 2 ステップ: パスワードで再認証 → 削除実行
  const onReAuthSubmit = async () => {
    if (reAuthing) return;
    if (!user?.email) {
      showToast('メールアドレスが取得できませんでした', 'error');
      return;
    }
    if (reAuthPwd.length < 4) {
      showToast('パスワードを入力してください', 'warn');
      return;
    }
    setReAuthing(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: reAuthPwd,
      });
      if (error) {
        showToast('パスワードが正しくありません', 'error');
        setReAuthing(false);
        return;
      }
      // 再認証成功 → 削除
      setReAuthOpen(false);
      setDeleting(true);
      const r = await deleteAccount();
      if (r.ok) {
        setUser(null);
        showToast('アカウントを削除しました', 'success');
        router.replace('/(auth)/login' as never);
      } else {
        showToast(r.error ?? '削除に失敗しました', 'error');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '削除に失敗しました';
      showToast(msg, 'error');
    } finally {
      setReAuthing(false);
      setDeleting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="アカウント管理" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        {/* アカウント情報 */}
        <View style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          gap: SP['2'],
        }}>
          <Text style={[T.smallM, { color: C.text3 }]}>メールアドレス</Text>
          <Text style={[T.body, { color: C.text }]}>{user?.email ?? '—'}</Text>
        </View>

        {/* データエクスポート */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h4, { color: C.text }]}>📦 自分のデータを書き出す</Text>
          <Text style={[T.small, { color: C.text2 }]}>
            投稿・コメント・いいね・タグ・通知など、Geek 上のあなたの活動データを JSON
            ファイルとしてダウンロードできます。GDPR / 個人情報保護法に基づくデータポータビリティ権の行使にもご利用ください。
          </Text>
          <PressableScale
            onPress={onExport}
            haptic="tap"
            disabled={exporting}
            accessibilityLabel="自分のデータを JSON でエクスポート"
            accessibilityState={{ disabled: exporting, busy: exporting }}
            style={{
              marginTop: SP['2'],
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP['2'],
              padding: SP['4'],
              backgroundColor: C.accent,
              borderRadius: R.lg,
              opacity: exporting ? 0.5 : 1,
            }}
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon.save size={18} color="#fff" strokeWidth={2.4} />
            )}
            <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
              {/* "準備中…" は意味曖昧 (未実装と誤読される) → ダウンロード中であると明示 */}
              {exporting ? 'エクスポート中…' : 'JSON でダウンロード'}
            </Text>
          </PressableScale>
        </View>

        {/* 危険ゾーン */}
        <View style={{
          padding: SP['4'],
          backgroundColor: C.redBg,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.red + '44',
          gap: SP['2'],
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Icon.warn size={18} color={C.red} strokeWidth={2.4} />
            <Text style={[T.h4, { color: C.red }]}>危険ゾーン</Text>
          </View>
          <Text style={[T.small, { color: C.text2 }]}>
            アカウントを削除すると、投稿・コメント・いいね・タグなど、Geek 上のすべてのデータが完全に消去され、復元はできません。
          </Text>
          <Text style={[T.caption, { color: C.text3, marginTop: SP['1'] }]}>
            このアプリは匿名 SNS のため、ニックネームは履歴に残らない場合がありますが、他のユーザーがすでに引用・スクリーンショットした内容には責任を負いかねます。
          </Text>
          <PressableScale
            onPress={() => setConfirmDelete(true)}
            haptic="warn"
            disabled={deleting}
            accessibilityLabel="アカウントを削除する。確認画面が次に表示されます。"
            accessibilityState={{ disabled: deleting, busy: deleting }}
            style={{
              marginTop: SP['3'],
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP['2'],
              padding: SP['4'],
              backgroundColor: C.red,
              borderRadius: R.lg,
              opacity: deleting ? 0.5 : 1,
            }}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon.trash size={18} color="#fff" strokeWidth={2.4} />
            )}
            <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
              {deleting ? '削除中…' : 'アカウントを削除する'}
            </Text>
          </PressableScale>
        </View>

        <Text style={[T.caption, { color: C.text3, textAlign: 'center', marginTop: SP['2'] }]}>
          ご不明な点はお問い合わせください
        </Text>
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        title="本当に削除しますか？"
        message={`「${user?.email ?? 'このアカウント'}」のすべてのデータが完全に削除されます。この操作は取り消せません。次の画面でパスワード再入力が必要です。`}
        confirmLabel="次へ"
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={onConfirmDelete}
      />

      {/* 再認証モーダル */}
      {reAuthOpen && (
        <View
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: SP['5'],
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 420,
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              padding: SP['5'],
              gap: SP['3'],
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Text style={[T.h3, { color: C.red }]}>パスワード再入力</Text>
            <Text style={[T.body, { color: C.text2 }]}>
              アカウントを削除するため、現在のパスワードを入力してください。
            </Text>
            <Input
              value={reAuthPwd}
              onChangeText={setReAuthPwd}
              placeholder="パスワード"
              secureTextEntry
              keyboardAppearance="dark"
              selectionColor={C.accent}
              autoFocus
              // bcrypt 上限 72 文字 + 余裕 (memory DoS 対策)
              maxLength={128}
            />
            <View style={{ flexDirection: 'row', gap: SP['2'], marginTop: SP['2'] }}>
              <PressableScale
                onPress={() => { setReAuthOpen(false); setReAuthPwd(''); }}
                haptic="tap"
                disabled={reAuthing}
                style={{
                  flex: 1,
                  padding: SP['3'],
                  backgroundColor: C.bg3,
                  borderRadius: R.md,
                  alignItems: 'center',
                  opacity: reAuthing ? 0.5 : 1,
                }}
              >
                <Text style={[T.bodyMd, { color: C.text, fontWeight: '600' }]}>キャンセル</Text>
              </PressableScale>
              <PressableScale
                onPress={onReAuthSubmit}
                haptic="warn"
                disabled={reAuthing || reAuthPwd.length < 4}
                style={{
                  flex: 1,
                  padding: SP['3'],
                  backgroundColor: C.red,
                  borderRadius: R.md,
                  alignItems: 'center',
                  opacity: (reAuthing || reAuthPwd.length < 4) ? 0.5 : 1,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: SP['1'],
                }}
              >
                {reAuthing && <ActivityIndicator size="small" color="#fff" />}
                <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700' }]}>
                  {reAuthing ? '確認中…' : '削除を実行'}
                </Text>
              </PressableScale>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
