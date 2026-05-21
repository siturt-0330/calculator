// ============================================================
// 公式コミュニティ申請画面
// ============================================================
// コミュニティ owner のみがアクセス可能。
// 申請内容: 実名 / 所属組織 / メール / URL / 申請理由 / 利用したい機能
// 投稿は常に有効 (disabled toggle)。
// 送信成功で toast + 戻る。
// ============================================================
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useMemo, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { BackButton } from '../../../../components/nav/BackButton';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Spinner } from '../../../../components/ui/Spinner';
import { Icon } from '../../../../constants/icons';
import { useToastStore } from '../../../../stores/toastStore';
import { useAuthStore } from '../../../../stores/authStore';
import { fetchCommunity } from '../../../../lib/api/communities';
import {
  applyForOfficialCommunity,
  fetchApplication,
  verifyOfficialUrl,
  type OfficialApplication,
  type OfficialFeature,
} from '../../../../lib/api/officialCommunities';
import { TABBAR } from '../../../../design/tabbar';

type FeatureOpt = { key: OfficialFeature; label: string; description: string; always?: boolean };
const FEATURES: FeatureOpt[] = [
  { key: 'qna',      label: 'Q&Aコーナー',  description: '登録ナレッジに基づく回答' },
  { key: 'calendar', label: 'カレンダー',   description: 'イベント告知' },
  { key: 'map',      label: '地図',         description: '聖地巡礼 / 観光マップ' },
];

function isValidEmail(s: string): boolean {
  if (!s) return true; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isValidHttpsUrl(s: string): boolean {
  if (!s) return true; // optional
  return /^https:\/\//.test(s);
}

export default function ApplyOfficialScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const userId = useAuthStore((s) => s.user?.id);
  const { show } = useToastStore();

  const { data: community, isLoading } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });

  const isOwner =
    !!community &&
    (community.role === 'owner' || (userId && community.created_by === userId));

  const [realName, setRealName] = useState('');
  const [organization, setOrganization] = useState('');
  const [email, setEmail] = useState('');
  const [url, setUrl] = useState('');
  const [purpose, setPurpose] = useState('');
  const [selected, setSelected] = useState<Record<OfficialFeature, boolean>>({
    qna: false, calendar: false, map: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [createdAppId, setCreatedAppId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // 申請が作成されたら token を取得するために単票 fetch
  const { data: createdApp, refetch: refetchApp } = useQuery({
    queryKey: ['official-application', createdAppId],
    queryFn: () => fetchApplication(createdAppId!),
    enabled: !!createdAppId,
    staleTime: 5_000,
  });

  const errors = useMemo(() => {
    const e: Record<string, string | undefined> = {};
    if (realName.length > 0 && (realName.length < 1 || realName.length > 80)) e.realName = '1〜80文字で入力';
    if (organization.length > 0 && (organization.length < 1 || organization.length > 120)) e.organization = '1〜120文字で入力';
    if (email && !isValidEmail(email)) e.email = 'メール形式が正しくありません';
    if (url && !isValidHttpsUrl(url)) e.url = 'https:// で始まる URL を入力';
    if (purpose.length > 0 && (purpose.length < 10 || purpose.length > 2000)) e.purpose = '10〜2000文字で入力';
    return e;
  }, [realName, organization, email, url, purpose]);

  const canSubmit =
    !submitting &&
    realName.trim().length >= 1 && realName.length <= 80 &&
    organization.trim().length >= 1 && organization.length <= 120 &&
    purpose.trim().length >= 10 && purpose.length <= 2000 &&
    isValidEmail(email) &&
    isValidHttpsUrl(url);

  const onToggleFeature = (k: OfficialFeature) => {
    setSelected((s) => ({ ...s, [k]: !s[k] }));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const requestedFeatures = (Object.keys(selected) as OfficialFeature[]).filter((k) => selected[k]);
      const newId = await applyForOfficialCommunity({
        communityId: id,
        realName: realName.trim(),
        organization: organization.trim(),
        email: email.trim() || undefined,
        url: url.trim() || undefined,
        purpose: purpose.trim(),
        requestedFeatures,
      });
      show('公式申請を送信しました', 'success');
      // URL を入力していれば検証パネルへ移行、なければそのまま戻る
      if (url.trim()) {
        setCreatedAppId(newId);
      } else {
        router.back();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '申請に失敗しました';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (!createdAppId) return;
    setVerifying(true);
    try {
      const res = await verifyOfficialUrl(createdAppId);
      if (res.status === 'verified') {
        show(`URL を確認しました (${res.method ?? ''})`, 'success');
      } else {
        show('URL の確認に失敗しました。トークン設置を確認してください', 'error');
      }
      await refetchApp();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '検証に失敗しました';
      show(msg, 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await Clipboard.setStringAsync(token);
      show('トークンをコピーしました', 'success');
    } catch {
      show('コピーに失敗しました', 'error');
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Spinner size="large" />
      </View>
    );
  }

  if (!community) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <BackButton />
        <EmptyState
          icon={Icon.fail}
          title="コミュニティが見つかりません"
          message="削除されたか、閲覧権限がない可能性があります"
        />
      </View>
    );
  }

  if (community.is_official) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <BackButton />
        <EmptyState
          icon={Icon.check}
          title="既に公式コミュニティです"
          message="このコミュニティはすでに公式認証されています"
          tone="accent"
        />
      </View>
    );
  }

  if (!isOwner) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <BackButton />
        <EmptyState
          icon={Icon.lock}
          title="権限がありません"
          message="コミュニティのオーナーのみが公式申請できます"
        />
      </View>
    );
  }

  // 申請成功後の URL 検証パネル
  if (createdAppId) {
    return (
      <VerifyPanel
        app={createdApp ?? null}
        onVerify={handleVerify}
        onCopy={handleCopyToken}
        verifying={verifying}
        onDone={() => router.back()}
        topInset={insets.top}
        bottomInset={insets.bottom}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>公式申請</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: TABBAR.height + insets.bottom + SP['16'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={FadeInDown.duration(220)}>
          <View
            style={[{
              padding: SP['4'],
              backgroundColor: C.accentBg,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.accent + '55',
              gap: SP['2'],
            }, SHADOW.card]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Icon.shield size={16} color={C.accentLight} strokeWidth={2.4} />
              <Text style={[T.bodyB, { color: C.accentLight, fontWeight: '800' }]}>公式コミュニティについて</Text>
            </View>
            <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>
              管理者の身元 (実名・所属) を公開する代わりに、Q&A・カレンダー・地図など公式専用機能が使えるようになります。一般メンバーは引き続き匿名です。承認には開発者の審査が必要です。
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(40).duration(220)}>
          <Input
            label="実名 (必須)"
            placeholder="例: 山田 太郎"
            value={realName}
            onChangeText={setRealName}
            maxLength={80}
            error={errors.realName}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(60).duration(220)}>
          <Input
            label="所属組織 (必須)"
            placeholder="例: ○○市役所 / TVアニメ○○製作委員会"
            value={organization}
            onChangeText={setOrganization}
            maxLength={120}
            error={errors.organization}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(80).duration(220)}>
          <Input
            label="メールアドレス (任意)"
            placeholder="contact@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            error={errors.email}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(100).duration(220)}>
          <Input
            label="公式ウェブサイト URL (任意)"
            placeholder="https://example.com"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            keyboardType="url"
            error={errors.url}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(220)}>
          <Input
            label="申請理由 (必須, 10〜2000文字)"
            placeholder="どのような目的でこのコミュニティを運営したいか、申請する機能をどう使うか、など"
            value={purpose}
            onChangeText={setPurpose}
            multiline
            numberOfLines={6}
            maxLength={2000}
            textAlignVertical="top"
            error={errors.purpose}
          />
          <Text style={[T.caption, { color: C.text3, marginTop: 4, textAlign: 'right' }]}>
            {purpose.length} / 2000
          </Text>
        </Animated.View>

        {/* 機能セレクタ */}
        <Animated.View entering={FadeInDown.delay(140).duration(220)} style={{ gap: SP['2'] }}>
          <Text style={[T.small, { color: C.text2, fontWeight: '700' }]}>利用したい機能</Text>
          <View style={{ flexDirection: 'row', gap: SP['2'], flexWrap: 'wrap' }}>
            {/* 投稿 は常に有効 (disabled) */}
            <View
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 8,
                backgroundColor: C.accent,
                borderRadius: R.full,
                opacity: 0.7,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>投稿 (必須)</Text>
            </View>
            {FEATURES.map((f) => {
              const active = selected[f.key];
              return (
                <PressableScale
                  key={f.key}
                  onPress={() => onToggleFeature(f.key)}
                  haptic="select"
                  scaleValue={0.96}
                  style={{
                    paddingHorizontal: SP['3'],
                    paddingVertical: 8,
                    backgroundColor: active ? C.accent : C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: active ? C.accent : C.border,
                  }}
                >
                  <Text style={{ color: active ? '#fff' : C.text2, fontSize: 12, fontWeight: '700' }}>
                    {f.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            申請後の機能変更は再申請で行います
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160).duration(220)}>
          <Button
            label={submitting ? '送信中…' : '申請を送信'}
            onPress={handleSubmit}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canSubmit}
            loading={submitting}
            haptic="confirm"
          />
        </Animated.View>
      </ScrollView>

      {submitting && (
        <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + SP['4'], right: SP['4'] }}>
          <ActivityIndicator size="small" color={C.accent} />
        </View>
      )}
    </View>
  );
}

// ============================================================
// 申請成功後の URL 所有確認パネル
// ============================================================
function VerifyPanel({
  app,
  onVerify,
  onCopy,
  verifying,
  onDone,
  topInset,
  bottomInset,
}: {
  app: OfficialApplication | null;
  onVerify: () => void;
  onCopy: (token: string) => void;
  verifying: boolean;
  onDone: () => void;
  topInset: number;
  bottomInset: number;
}) {
  const token = app?.verification_token ?? '';
  const status = app?.verification_status ?? 'unverified';
  const verified = status === 'verified';
  const failed = status === 'failed';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          paddingTop: topInset + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>URL を確認</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: TABBAR.height + bottomInset + SP['16'],
          gap: SP['4'],
        }}
      >
        <Animated.View entering={FadeIn.duration(220)}>
          <View
            style={[{
              padding: SP['4'],
              backgroundColor: verified ? C.greenBg : C.accentBg,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: (verified ? C.green : C.accent) + '55',
              gap: SP['2'],
            }, SHADOW.card]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Icon.check size={16} color={verified ? C.green : C.accentLight} strokeWidth={2.4} />
              <Text style={[T.bodyB, { color: verified ? C.green : C.accentLight, fontWeight: '800' }]}>
                {verified ? 'URL 確認済み' : '公式 URL の所有確認'}
              </Text>
            </View>
            <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>
              {verified
                ? 'ありがとうございます。本人確認の一環として URL を所有していることが確認できました。審査がスムーズに進みます。'
                : '申請が送信されました。下記いずれかの方法でトークンを公式 URL に設置し、「URL を検証する」を押してください。'}
            </Text>
          </View>
        </Animated.View>

        {!app ? (
          <View style={{ paddingVertical: SP['8'], alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : (
          <>
            {/* token + コピー */}
            <Animated.View entering={FadeInDown.delay(40).duration(220)} style={{ gap: SP['2'] }}>
              <Text style={[T.caption, { color: C.text3, letterSpacing: 0.6 }]}>確認トークン</Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['2'],
                  padding: SP['3'],
                  backgroundColor: C.bg3,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text
                  selectable
                  style={{
                    color: C.text,
                    flex: 1,
                    fontFamily: 'Courier',
                    fontSize: 13,
                    fontWeight: '700',
                    letterSpacing: 0.4,
                  }}
                  numberOfLines={1}
                >
                  {token || '(取得中...)'}
                </Text>
                <PressableScale
                  onPress={() => token && onCopy(token)}
                  haptic="tap"
                  disabled={!token}
                  scaleValue={0.94}
                  style={{
                    paddingHorizontal: SP['3'],
                    paddingVertical: 8,
                    backgroundColor: C.accent,
                    borderRadius: R.md,
                    opacity: token ? 1 : 0.5,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>コピー</Text>
                </PressableScale>
              </View>
            </Animated.View>

            {/* 方法 1: well-known */}
            <Animated.View entering={FadeInDown.delay(60).duration(220)}>
              <View
                style={{
                  padding: SP['4'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  gap: SP['2'],
                }}
              >
                <Text style={[T.bodyB, { color: C.text, fontWeight: '800' }]}>方法 1: well-known ファイル</Text>
                <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>
                  公式 URL の{' '}
                  <Text style={{ fontFamily: 'Courier', color: C.accentLight }}>
                    /.well-known/geek-verify.txt
                  </Text>{' '}
                  にこのトークンを書いたテキストファイルを設置してください。
                </Text>
                <View
                  style={{
                    padding: SP['3'],
                    backgroundColor: C.bg3,
                    borderRadius: R.sm,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Text style={{ color: C.text, fontFamily: 'Courier', fontSize: 12 }}>
                    {token}
                  </Text>
                </View>
              </View>
            </Animated.View>

            {/* 方法 2: meta-tag */}
            <Animated.View entering={FadeInDown.delay(80).duration(220)}>
              <View
                style={{
                  padding: SP['4'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  gap: SP['2'],
                }}
              >
                <Text style={[T.bodyB, { color: C.text, fontWeight: '800' }]}>方法 2: meta タグ</Text>
                <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>
                  公式 URL の{' '}
                  <Text style={{ fontFamily: 'Courier', color: C.accentLight }}>{'<head>'}</Text>{' '}
                  内に下記の meta タグを追加してください。
                </Text>
                <View
                  style={{
                    padding: SP['3'],
                    backgroundColor: C.bg3,
                    borderRadius: R.sm,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Text style={{ color: C.text, fontFamily: 'Courier', fontSize: 11 }} selectable>
                    {`<meta name="geek-verify" content="${token}">`}
                  </Text>
                </View>
              </View>
            </Animated.View>

            {/* 検証ボタン */}
            {!verified && (
              <Animated.View entering={FadeInDown.delay(100).duration(220)} style={{ gap: SP['2'] }}>
                <Button
                  label={verifying ? '検証中…' : 'URL を検証する'}
                  onPress={onVerify}
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={verifying || !token}
                  loading={verifying}
                  haptic="confirm"
                />
                {failed && (
                  <Text style={[T.caption, { color: C.amber, textAlign: 'center' }]}>
                    前回の検証は失敗しました。トークンの設置が正しいか確認してください
                  </Text>
                )}
              </Animated.View>
            )}

            {/* 完了 */}
            <Animated.View entering={FadeInDown.delay(120).duration(220)}>
              <PressableScale
                onPress={onDone}
                haptic="tap"
                style={{
                  paddingVertical: SP['3'],
                  alignItems: 'center',
                  borderRadius: R.lg,
                  backgroundColor: C.bg3,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text style={[T.bodyB, { color: C.text2, fontWeight: '700' }]}>
                  {verified ? '閉じる' : '後で検証する'}
                </Text>
              </PressableScale>
            </Animated.View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
