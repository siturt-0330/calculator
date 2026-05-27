// ============================================================
// app/admin/support.tsx — Modmail admin 管理画面
// ============================================================
// 一覧 (state='new' を最上位 / unread_count_for_admin 多い順 / last_message_at desc):
//   - state filter chip 行 (全部 / 未対応 / 対応中 / 解決済)
//   - category filter chip 行 (全部 + 6 カテゴリ)
//   - 各 thread → /support/[id] へ遷移 (admin 視点で表示)
// ============================================================
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { SupportThreadCard } from '../../components/support/SupportThreadCard';
import { useAdminSupportThreads } from '../../hooks/useSupportThreads';
import {
  CATEGORY_META,
  type SupportThreadCategory,
  type SupportThreadState,
} from '../../lib/api/support';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

type StateFilter = SupportThreadState | 'all';
type CategoryFilter = SupportThreadCategory | 'all';

const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'new', label: '未対応' },
  { value: 'in_progress', label: '対応中' },
  { value: 'archived', label: '解決済' },
];

const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'account_appeal', label: '⚖️ BAN' },
  { value: 'rule_question', label: '📖 ルール' },
  { value: 'community_question', label: '🏛️ コミュ' },
  { value: 'bug_report', label: '🐛 バグ' },
  { value: 'feature_request', label: '✨ 要望' },
  { value: 'other', label: '💬 その他' },
];

export default function AdminSupportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const { threads, isLoading } = useAdminSupportThreads({
    state: stateFilter,
    category: categoryFilter,
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="お問い合わせ管理" left={<BackButton />} />

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['10'],
        }}
      >
        {/* state filter */}
        <View
          style={{
            paddingHorizontal: SP['4'],
            paddingTop: SP['3'],
            paddingBottom: SP['2'],
            flexDirection: 'row',
            gap: SP['2'],
            flexWrap: 'wrap',
          }}
        >
          {STATE_FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={stateFilter === f.value}
              onPress={() => setStateFilter(f.value)}
            />
          ))}
        </View>

        {/* category filter (horizontal scroll) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: SP['4'],
            paddingBottom: SP['3'],
            gap: SP['2'],
            flexDirection: 'row',
          }}
        >
          {CATEGORY_FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={categoryFilter === f.value}
              onPress={() => setCategoryFilter(f.value)}
            />
          ))}
        </ScrollView>

        {/* counts summary */}
        {!isLoading && threads.length > 0 && (
          <View
            style={{
              paddingHorizontal: SP['4'],
              paddingBottom: SP['2'],
              flexDirection: 'row',
              gap: SP['3'],
              alignItems: 'center',
            }}
          >
            <Text style={[T.caption, { color: C.text3 }]}>
              {threads.length} 件
            </Text>
            <SummaryDot
              color={C.amber}
              label={`未対応 ${threads.filter((t) => t.state === 'new').length}`}
            />
            <SummaryDot
              color={C.accent}
              label={`対応中 ${threads.filter((t) => t.state === 'in_progress').length}`}
            />
          </View>
        )}

        {/* 一覧 */}
        <View style={{ paddingHorizontal: SP['4'] }}>
          {isLoading ? (
            <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
              <Spinner />
            </View>
          ) : threads.length === 0 ? (
            <EmptyState
              icon={Icon.comment}
              title="該当する問い合わせはありません"
              message="フィルタを変えてみてください。"
              tone="neutral"
            />
          ) : (
            threads.map((thread) => {
              const cat = CATEGORY_META[thread.category];
              void cat;
              return (
                <SupportThreadCard
                  key={thread.id}
                  thread={thread}
                  authorNickname={thread.nickname}
                  asAdmin
                  onPress={() => router.push(`/support/${thread.id}` as never)}
                />
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      hitSlop={6}
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: 6,
        backgroundColor: active ? C.accentBg : C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: active ? C.accent + '66' : C.border,
      }}
    >
      <Text
        style={[
          T.caption,
          {
            color: active ? C.accentLight : C.text2,
            fontWeight: '700',
          },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

function SummaryDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
    </View>
  );
}
