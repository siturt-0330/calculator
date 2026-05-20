import { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import { C, GRAD, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

const FREE = [
  '基本投稿・閲覧',
  'タグフィルター',
  '掲示板（無制限）',
  '通報・ブロック機能',
];

const PRO = [
  '広告非表示',
  'プレミアムタグ作成',
  'コーナー機能フル開放',
  '優先サポート',
  'カスタムアバター無制限',
  '統計ダッシュボード',
];

export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { show } = useToastStore();
  const qc = useQueryClient();
  const Check = Icon.check;
  const Award = Icon.award;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downgradeOpen, setDowngradeOpen] = useState(false);

  const { data: plan = 'free' } = useQuery({
    queryKey: ['plan', user?.id],
    queryFn: async () => {
      if (!user) return 'free';
      const { data } = await supabase.from('profiles').select('plan').eq('id', user.id).single();
      return (data?.plan ?? 'free') as 'free' | 'pro';
    },
    enabled: !!user,
    // プランは滅多に変わらない — 5 分は再 fetch しない
    staleTime: 5 * 60_000,
  });

  const { mutate: changePlan, isPending } = useMutation({
    mutationFn: async (newPlan: 'free' | 'pro') => {
      if (!user) return;
      await supabase.from('profiles').update({ plan: newPlan }).eq('id', user.id);
    },
    onSuccess: (_, newPlan) => {
      qc.invalidateQueries({ queryKey: ['plan', user?.id] });
      show(newPlan === 'pro' ? '🎉 Proプランへようこそ！' : 'Freeプランに戻しました', 'success');
    },
    onError: () => show('プラン変更に失敗しました', 'error'),
  });

  const isPro = plan === 'pro';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="プラン" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
      >
        {/* 現在のプラン表示 */}
        <View style={{
          padding: SP['3'],
          backgroundColor: isPro ? C.accentBg : C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: isPro ? C.accent : C.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
        }}>
          <Text style={{ fontSize: 20 }}>{isPro ? '👑' : '🆓'}</Text>
          <Text style={[T.bodyMd, { color: C.text, flex: 1 }]}>
            現在のプラン: <Text style={{ color: isPro ? C.accentLight : C.text2, fontWeight: '700' }}>{isPro ? 'Pro' : 'Free'}</Text>
          </Text>
        </View>

        {/* Free */}
        <View style={{
          padding: SP['5'],
          backgroundColor: C.bg2,
          borderRadius: R.xl,
          borderWidth: 1,
          borderColor: !isPro ? C.green : C.border,
          gap: SP['3'],
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[T.h2, { color: C.text }]}>Free</Text>
            {!isPro && (
              <View style={{ paddingHorizontal: SP['2'], paddingVertical: 2, backgroundColor: C.greenBg, borderRadius: R.sm }}>
                <Text style={[T.caption, { color: C.green }]}>利用中</Text>
              </View>
            )}
          </View>
          <Text style={[T.h1, { color: C.text }]}>¥0<Text style={[T.body, { color: C.text3 }]}> / 月</Text></Text>
          <View style={{ gap: SP['2'], marginTop: SP['2'] }}>
            {FREE.map((f, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <Check size={16} color={C.green} strokeWidth={2.4} />
                <Text style={[T.body, { color: C.text2 }]}>{f}</Text>
              </View>
            ))}
          </View>
          {isPro && (
            <View style={{ marginTop: SP['3'] }}>
              <Button label="Freeに戻す" onPress={() => setDowngradeOpen(true)} variant="ghost" />
            </View>
          )}
        </View>

        {/* Pro */}
        <LinearGradient
          colors={[...GRAD.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: R.xl, padding: 2 }}
        >
          <View style={{
            padding: SP['5'],
            backgroundColor: C.bg2,
            borderRadius: R.xl - 2,
            gap: SP['3'],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Award size={20} color={C.accentLight} strokeWidth={2} />
              <Text style={[T.h2, { color: C.text }]}>Pro</Text>
              {isPro ? (
                <View style={{ paddingHorizontal: SP['2'], paddingVertical: 2, backgroundColor: C.accentSoft, borderRadius: R.sm }}>
                  <Text style={[T.caption, { color: C.accentLight }]}>利用中</Text>
                </View>
              ) : (
                <View style={{ paddingHorizontal: SP['2'], paddingVertical: 2, backgroundColor: C.accentSoft, borderRadius: R.sm }}>
                  <Text style={[T.caption, { color: C.accentLight }]}>おすすめ</Text>
                </View>
              )}
            </View>
            <Text style={[T.h1, { color: C.text }]}>¥480<Text style={[T.body, { color: C.text3 }]}> / 月</Text></Text>
            <View style={{ gap: SP['2'], marginTop: SP['2'] }}>
              {PRO.map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                  <Check size={16} color={C.accentLight} strokeWidth={2.4} />
                  <Text style={[T.body, { color: C.text }]}>{f}</Text>
                </View>
              ))}
            </View>
            {!isPro && (
              <View style={{ marginTop: SP['3'] }}>
                <Button label="Proにアップグレード" onPress={() => setConfirmOpen(true)} loading={isPending} haptic="confirm" />
              </View>
            )}
          </View>
        </LinearGradient>

        <Text style={[T.caption, { color: C.text3, textAlign: 'center', marginTop: SP['2'] }]}>
          いつでも切り替え可能・初回登録は無料
        </Text>
      </ScrollView>

      <ConfirmDialog
        visible={confirmOpen}
        title="Proにアップグレードしますか？"
        message="広告非表示・カスタムアバター無制限・コーナーフル開放など、すべての機能をご利用いただけます。"
        confirmLabel="アップグレード"
        cancelLabel="キャンセル"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          changePlan('pro');
        }}
      />

      <ConfirmDialog
        visible={downgradeOpen}
        title="Freeプランに戻しますか？"
        message="一部のPro限定機能が使えなくなります。"
        confirmLabel="戻す"
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setDowngradeOpen(false)}
        onConfirm={() => {
          setDowngradeOpen(false);
          changePlan('free');
        }}
      />
    </View>
  );
}
