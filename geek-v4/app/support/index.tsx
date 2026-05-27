// ============================================================
// app/support/index.tsx — Modmail 一覧 (user 用)
// ============================================================
// レイアウト:
//   - TopBar 「お問い合わせ」 + BackButton + 右側 「+ 新規」 gradient pill
//   - SegmentedControl 進行中 (new + in_progress) / 解決済 (archived)
//   - 各 thread を SupportThreadCard で表示
//   - empty state: 「まだ問い合わせがありません」+ CTA
// ============================================================
import { useMemo, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { SupportThreadCard } from '../../components/support/SupportThreadCard';
import { useMySupportThreads } from '../../hooks/useSupportThreads';
import { Icon } from '../../constants/icons';
import { C, GRAD, R, SHADOW, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { LinearGradient } from 'expo-linear-gradient';

type Tab = 'open' | 'archived';

export default function SupportIndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('open');
  const { threads, isLoading } = useMySupportThreads();

  const filtered = useMemo(() => {
    if (tab === 'open') {
      return threads.filter((t) => t.state !== 'archived');
    }
    return threads.filter((t) => t.state === 'archived');
  }, [threads, tab]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="お問い合わせ"
        left={<BackButton />}
        right={
          <PressableScale
            onPress={() => router.push('/support/new' as never)}
            haptic="tap"
            hitSlop={8}
            style={[
              {
                borderRadius: R.full,
                overflow: 'hidden',
              },
              SHADOW.glow,
            ]}
          >
            <LinearGradient
              colors={GRAD.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Icon.plus size={14} color="#fff" strokeWidth={2.6} />
              <Text style={[T.smallM, { color: '#fff', fontWeight: '800' }]}>新規</Text>
            </LinearGradient>
          </PressableScale>
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: insets.bottom + SP['10'],
        }}
      >
        {/* SegmentedControl */}
        <View style={{ marginBottom: SP['4'] }}>
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'open', label: '進行中' },
              { value: 'archived', label: '解決済' },
            ]}
          />
        </View>

        {/* 一覧 */}
        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <Spinner />
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Icon.comment}
            title={tab === 'open' ? 'まだ問い合わせがありません' : '解決済はまだありません'}
            message={
              tab === 'open'
                ? '運営に質問・要望・バグ報告などがあれば、新規スレッドを作成してください。'
                : '解決した問い合わせはここに表示されます。'
            }
            actionLabel={tab === 'open' ? '新規問い合わせ' : undefined}
            onAction={tab === 'open' ? () => router.push('/support/new' as never) : undefined}
            tone="accent"
          />
        ) : (
          filtered.map((thread) => (
            <SupportThreadCard
              key={thread.id}
              thread={thread}
              asAdmin={false}
              onPress={() => router.push(`/support/${thread.id}` as never)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
