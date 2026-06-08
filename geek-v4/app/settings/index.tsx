import { useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useAuthStore } from '../../stores/authStore';
import { useIntroStore } from '../../stores/introStore';
import { useLanguageStore, LANG_OPTIONS } from '../../stores/languageStore';
import { useThemeStore, useResolvedTheme } from '../../lib/theme/themeStore';
import { useIsAdmin } from '../../hooks/useAdmin';
import { useColors } from '../../hooks/useColors';
import { supabase } from '../../lib/supabase';
import { fetchMyOfficialCommunities } from '../../lib/api/officialCommunities';
import type { Community } from '../../lib/api/communities';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SectionCard } from '../../components/settings/SectionCard';
import { SettingsRow } from '../../components/settings/SettingsRow';
import { UserIdentityCard } from '../../components/settings/UserIdentityCard';
import { Icon } from '../../constants/icons';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';

// ============================================================
// Settings screen — 「コンテンツの充実 + 美しく分かりやすく」リデザイン (2026-05)
// ------------------------------------------------------------
// 構成:
//   1. UserIdentityCard          (自分のアバター + nickname + trust tier + Edit CTA)
//   2. SectionCard "あなたの活動"  (自分の投稿 / いいね / 保存 / 運営メッセージ / Geek Official)
//   3. SectionCard "アカウント"   (プロフィール / 状態 / プラン / 信用スコア / 問い合わせ)
//   4. SectionCard "カスタマイズ"  (テーマ / 言語 / 通知 / おすすめ自動化)
//   5. SectionCard "プライバシー"  (ブロックタグ / ブロックユーザー / プライバシー)
//   6. SectionCard "サポート"     (ヘルプ / 利用規約 / プライバシーポリシー / ライセンス)
//   7. (admin) SectionCard "管理"
//   8. SectionCard "アカウント管理" (ログアウト = destructive / アカウント削除 = destructive)
//   9. version footer            (タップ → /settings/about)
//
// 視覚改修:
//   - 各 row の icon が tint された rounded square (32x32) に。視覚スキャンが容易。
//   - 各セクション header は薄い uppercase + アイコンで「グループ感」を強化。
//   - 各セクションは bg2 + R.lg の角丸カードで包んで「分離感」を演出。
//   - 上部にユーザー identity カードで「自分の設定画面」と認識しやすく。
// ============================================================
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const C = useColors();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const isAdmin = useIsAdmin();
  const playIntro = useIntroStore((s) => s.play);
  const [logoutOpen, setLogoutOpen] = useState(false);
  // 現在言語を chip 表示する → 「気付かないうちに別言語になってる」事故を視覚的に防ぐ
  const lang = useLanguageStore((s) => s.lang);
  const langOption = LANG_OPTIONS.find((o) => o.code === lang);

  // 運営からの未読メッセージ件数 — 「あなたの活動」セクションの数字バッジ用。
  // 同じ queryKey を messages.tsx 側 + mypage 側 (旧) でも使うため、既読化で即減る。
  const { data: unreadAdminMessages = 0 } = useQuery<number>({
    queryKey: ['admin-messages-unread-count', user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from('admin_messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .is('read_at', null);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  // 公式コミュ管理者の場合のみ「Geek Official」行を出す
  const { data: officialCommunities = [] } = useQuery<Community[]>({
    queryKey: ['my-official-communities', user?.id],
    queryFn: fetchMyOfficialCommunities,
    enabled: !!user,
    staleTime: 60_000,
  });
  const hasOfficial = officialCommunities.length > 0;

  const version = Constants.expoConfig?.version ?? '4.0.0';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ───────── 1. ユーザー identity カード ───────── */}
        <UserIdentityCard />

        {/* ───────── 2. あなたの活動 ───────── */}
        <SectionCard title="あなたの活動" icon={Icon.sparkles}>
          <SettingsRow
            icon={Icon.edit}
            label="自分の投稿"
            tintBg={C.accentSoft}
            tintFg={C.accent}
            onPress={() => router.push('/mypage/posts' as never)}
          />
          <SettingsRow
            icon={Icon.heart}
            label="いいねした投稿"
            tintBg={C.pinkBg}
            tintFg={C.pink}
            onPress={() => router.push('/mypage/liked' as never)}
          />
          <SettingsRow
            icon={Icon.save}
            label="保存した投稿"
            tintBg={C.amberBg}
            tintFg={C.amber}
            onPress={() => router.push('/mypage/saved' as never)}
          />
          <SettingsRow
            icon={Icon.send}
            label="運営からのメッセージ"
            tintBg={C.blueBg}
            tintFg={C.blue}
            right={unreadAdminMessages > 0 ? <CountPill text={String(unreadAdminMessages)} /> : undefined}
            onPress={() => router.push('/mypage/messages' as never)}
          />
          {hasOfficial && (
            <SettingsRow
              icon={Icon.shield}
              label="Geek Official"
              sublabel="公式コミュニティ管理"
              tintBg={C.accentSoft}
              tintFg={C.accent}
              right={<CountPill text={String(officialCommunities.length)} accent />}
              onPress={() => router.push('/official' as never)}
            />
          )}
        </SectionCard>

        {/* ───────── 3. アカウント ───────── */}
        <SectionCard title="アカウント" icon={Icon.mypage}>
          <SettingsRow
            icon={Icon.edit}
            label="プロフィール編集"
            sublabel="ニックネーム / アバター / 自己紹介"
            onPress={() => router.push('/settings/profile-edit' as never)}
          />
          <SettingsRow
            icon={Icon.shield}
            label="アカウント状態"
            sublabel="制限 / 警告 / 健全性を確認"
            onPress={() => router.push('/settings/account-state' as never)}
          />
          <SettingsRow
            icon={Icon.award}
            label="信頼スコア"
            sublabel="あなたの活動スコアを見る"
            tintBg={C.amberBg}
            tintFg={C.amber}
            onPress={() => router.push('/settings/trust-score' as never)}
          />
          <SettingsRow
            icon={Icon.sparkles}
            label="プラン"
            onPress={() => router.push('/settings/plan' as never)}
          />
          <SettingsRow
            icon={Icon.help}
            label="運営にお問い合わせ"
            onPress={() => router.push('/support' as never)}
          />
        </SectionCard>

        {/* ───────── 4. カスタマイズ ───────── */}
        <SectionCard title="カスタマイズ" icon={Icon.settings}>
          <SettingsRow
            icon={Icon.palette}
            label="外観"
            sublabel="ライト / ダーク / システム連動"
            tintBg={C.accentSoft}
            tintFg={C.accent}
            right={<AppearanceChip />}
            onPress={() => router.push('/settings/appearance' as never)}
          />
          <SettingsRow
            icon={Icon.globe}
            label="言語"
            tintBg={C.blueBg}
            tintFg={C.blue}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>
                  {langOption ? `${langOption.flag} ${langOption.native}` : lang}
                </Text>
                <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
              </View>
            }
            onPress={() => router.push('/settings/language' as never)}
          />
          <SettingsRow
            icon={Icon.bell}
            label="通知設定"
            sublabel="プッシュ通知 / 種類別の ON/OFF"
            tintBg={C.amberBg}
            tintFg={C.amber}
            onPress={() => router.push('/settings/notifications' as never)}
          />
          <SettingsRow
            icon={Icon.sparkles}
            label="おすすめ・自動化"
            sublabel="タグの自動グループ化"
            onPress={() => router.push('/settings/recommendations' as never)}
          />
        </SectionCard>

        {/* ───────── 5. プライバシー ───────── */}
        <SectionCard title="プライバシー" icon={Icon.lock}>
          <SettingsRow
            icon={Icon.lock}
            label="プライバシー設定"
            sublabel="公開範囲・データ共有"
            tintBg={C.bg4}
            tintFg={C.text2}
            onPress={() => router.push('/settings/privacy' as never)}
          />
          <SettingsRow
            icon={Icon.hash}
            label="ブロックしたタグ"
            tintBg={C.bg4}
            tintFg={C.text2}
            onPress={() => router.push('/settings/blocked-tags' as never)}
          />
          <SettingsRow
            icon={Icon.block}
            label="ブロックしたユーザー"
            tintBg={C.blockBg}
            tintFg={C.block}
            onPress={() => router.push('/settings/blocked-users' as never)}
          />
          <SettingsRow
            icon={Icon.shield}
            label="データとアカウント"
            sublabel="エクスポート・アカウント削除"
            tintBg={C.bg4}
            tintFg={C.text2}
            onPress={() => router.push('/settings/account' as never)}
          />
        </SectionCard>

        {/* ───────── 6. サポート ───────── */}
        <SectionCard title="サポート" icon={Icon.help}>
          <SettingsRow
            icon={Icon.help}
            label="ヘルプ・お問い合わせ"
            tintBg={C.blueBg}
            tintFg={C.blue}
            onPress={() => router.push('/settings/help' as never)}
          />
          <SettingsRow
            icon={Icon.info}
            label="利用規約"
            tintBg={C.bg4}
            tintFg={C.text2}
            onPress={() => router.push('/settings/terms' as never)}
          />
          <SettingsRow
            icon={Icon.shield}
            label="プライバシーポリシー"
            tintBg={C.bg4}
            tintFg={C.text2}
            onPress={() => router.push('/settings/privacy-policy' as never)}
          />
          <SettingsRow
            icon={Icon.flag}
            label="ライセンス"
            tintBg={C.bg4}
            tintFg={C.text2}
            onPress={() => router.push('/settings/license' as never)}
          />
          <SettingsRow
            icon={Icon.info}
            label="このアプリについて"
            tintBg={C.bg4}
            tintFg={C.text2}
            onPress={() => router.push('/settings/about' as never)}
          />
        </SectionCard>

        {/* ───────── 7. (admin only) 管理 ───────── */}
        {isAdmin && (
          <SectionCard title="管理" icon={Icon.shield} accent={C.amber}>
            <SettingsRow
              icon={Icon.shield}
              label="フィードバック管理"
              tintBg={C.amberBg}
              tintFg={C.amber}
              onPress={() => router.push('/settings/feedback-admin' as never)}
            />
          </SectionCard>
        )}

        {/* ───────── 8. その他 (devtools 等) ───────── */}
        <SectionCard title="その他" icon={Icon.sparkles}>
          <SettingsRow
            icon={Icon.sparkles}
            label="起動アニメーションを再生"
            sublabel="ロゴアニメをもう一度見る"
            onPress={playIntro}
          />
        </SectionCard>

        {/* ───────── 9. アカウント管理 (destructive) ───────── */}
        <SectionCard title="アカウント管理" icon={Icon.logout} accent={C.red}>
          <SettingsRow
            icon={Icon.logout}
            label="ログアウト"
            destructive
            onPress={() => setLogoutOpen(true)}
          />
          <SettingsRow
            icon={Icon.trash}
            label="アカウントを削除"
            sublabel="この操作は取り消せません"
            destructive
            onPress={() => router.push('/settings/account' as never)}
          />
        </SectionCard>

        {/* ───────── 10. version footer (タップ → /about) ───────── */}
        <PressableScale
          onPress={() => router.push('/settings/about' as never)}
          haptic="tap"
          accessibilityLabel="このアプリについて"
          style={{
            alignItems: 'center',
            paddingTop: SP['8'],
            paddingBottom: SP['4'],
            gap: 2,
          }}
        >
          <Text style={[T.captionM, { color: C.text3 }]}>GEEK v{version}</Text>
          <Text style={[T.caption, { color: C.text4 }]}>© 2026 Geek Project</Text>
        </PressableScale>
      </ScrollView>

      <ConfirmDialog
        visible={logoutOpen}
        title="ログアウトしますか？"
        message="再度ログインするにはメールアドレスとパスワードが必要です。"
        confirmLabel="ログアウト"
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => {
          setLogoutOpen(false);
          void signOut();
        }}
      />
    </View>
  );
}

// 外観行の右側 chip — 現在のテーマと システム連動かを 1 行で。
// useThemeStore + useResolvedTheme を購読しているので、別画面で切り替えると即更新。
function AppearanceChip() {
  const C = useColors();
  const mode = useThemeStore((s) => s.mode);
  const resolved = useResolvedTheme();
  const label =
    mode === 'system' ? (resolved === 'light' ? 'システム / ライト' : 'システム / ダーク')
    : mode === 'light' ? 'ライト'
    : 'ダーク';
  const Icn = resolved === 'light' ? Icon.sun : Icon.moon;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
      <Icn size={14} color={C.text2} strokeWidth={2.2} />
      <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>{label}</Text>
      <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
    </View>
  );
}

// 件数バッジ — accent=true で primary 色、false で red (未読の重要さ示す)
function CountPill({ text, accent = false }: { text: string; accent?: boolean }) {
  const C = useColors();
  return (
    <View
      style={{
        minWidth: 22,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: R.full,
        backgroundColor: accent ? C.accentBg : C.redBg,
        borderWidth: 1,
        borderColor: accent ? C.accentSoft : C.red + '44',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: '700',
          color: accent ? C.accentLight : C.red,
          letterSpacing: 0.3,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
