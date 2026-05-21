// ============================================================
// 公式コミュニティ申請画面
// ============================================================
// コミュニティ owner のみがアクセス可能。
// 申請内容: 実名 / 所属組織 / メール / URL / 申請理由 / 利用したい機能
// 投稿は常に有効 (disabled toggle)。
// 送信成功で toast + 戻る。
// ============================================================
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMemo, useState } from 'react';
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
import { applyForOfficialCommunity, type OfficialFeature } from '../../../../lib/api/officialCommunities';
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
      await applyForOfficialCommunity({
        communityId: id,
        realName: realName.trim(),
        organization: organization.trim(),
        email: email.trim() || undefined,
        url: url.trim() || undefined,
        purpose: purpose.trim(),
        requestedFeatures,
      });
      show('公式申請を送信しました', 'success');
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '申請に失敗しました';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
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
