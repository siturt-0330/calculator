import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, Layout } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Stat, EmptyBlock, ErrorBlock } from '../../components/admin/AdminBlocks';
import { Icon } from '../../constants/icons';
import { useToastStore } from '../../stores/toastStore';
import { useDebounce } from '../../hooks/useDebounce';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import {
  searchUsers,
  fetchShadowbannedUsers,
  toggleShadowban,
  type AdminUser,
} from '../../lib/api/admin';

// ============================================================
// /admin/users — Shadowban 管理画面 (Reddit ガイド #10 / 6.9 章)
// ============================================================
// 隠し /admin 配下なので _layout.tsx の email-gate を通る前提。
// 機能:
//   - 検索 input (nickname の ilike) → 検索結果一覧
//   - 「現在 Shadowban 中」一覧 (shadowbanned=true で並べる)
//   - 各 user 行に Shadowban toggle ボタン + 確認 dialog (誤操作防止)
// 設計指針:
//   - 既存 admin 画面 (index.tsx UsersTab, user/[id].tsx) と同じスタイルトーン
//   - shadowban は「凍結 (suspend)」と区別される: 凍結=明示禁止、shadowban=隠す
//   - 自分自身を ban しようとした時は DB 側で reject される (lockout 防止)
// ============================================================

const isWeb = Platform.OS === 'web';

export default function AdminUsersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [pending, setPending] = useState<{ user: AdminUser; banned: boolean } | null>(null);

  // 検索: 空クエリの時も最新登録順を最大 20 件返す UX。
  const searchQuery = useQuery({
    queryKey: ['admin-shadowban-search', debouncedQuery],
    queryFn: () => searchUsers(debouncedQuery, 20),
    staleTime: 15_000,
  });

  // 現在 ban 中: shadowbanned=true で取得 (admin RLS で全件見える)
  const bannedQuery = useQuery({
    queryKey: ['admin-shadowbanned-users'],
    queryFn: () => fetchShadowbannedUsers(100),
    staleTime: 15_000,
  });

  const toggle = useMutation({
    mutationFn: ({ id, banned }: { id: string; banned: boolean }) =>
      toggleShadowban(id, banned),
    onSuccess: (_data, vars) => {
      show(vars.banned ? 'Shadowban しました' : 'Shadowban を解除しました', vars.banned ? 'warn' : 'success');
      // 両 list を refetch
      void qc.invalidateQueries({ queryKey: ['admin-shadowban-search'] });
      void qc.invalidateQueries({ queryKey: ['admin-shadowbanned-users'] });
      // 既存 admin 画面の users list にも反映
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-user'] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : '失敗しました';
      show(`Shadowban に失敗: ${msg}`, 'error');
    },
  });

  const onTogglePress = useCallback((user: AdminUser) => {
    const banned = !user.shadowbanned;
    setPending({ user, banned });
  }, []);

  const confirmToggle = useCallback(() => {
    if (!pending) return;
    toggle.mutate({ id: pending.user.id, banned: pending.banned });
    setPending(null);
  }, [pending, toggle]);

  const searchList = useMemo(() => searchQuery.data ?? [], [searchQuery.data]);
  const bannedList = useMemo(() => bannedQuery.data ?? [], [bannedQuery.data]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="Shadowban 管理" left={<BackButton />} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['10'],
          paddingTop: SP['2'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ============ Hero / 説明 ============ */}
        <View style={{ paddingHorizontal: SP['4'] }}>
          <View
            style={[
              {
                padding: SP['4'],
                backgroundColor: C.bg2,
                borderRadius: R.xl,
                borderWidth: 1,
                borderColor: C.border,
                gap: SP['2'],
                overflow: 'hidden',
              },
              SHADOW.card,
            ]}
          >
            <LinearGradient
              colors={[C.accent + '22', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              pointerEvents="none"
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={{ fontSize: 28 }}>👻</Text>
              <Text
                style={{
                  fontFamily: FONT.display,
                  fontSize: 22,
                  lineHeight: 26,
                  color: C.text,
                  letterSpacing: -0.4,
                }}
              >
                Shadowban
              </Text>
              <View
                style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: 2,
                  backgroundColor: C.redBg,
                  borderRadius: R.sm,
                  borderWidth: 1,
                  borderColor: C.red + '55',
                }}
              >
                <Text style={{ fontSize: 11, color: C.red, fontWeight: '800', letterSpacing: 0.6 }}>
                  DEV
                </Text>
              </View>
            </View>
            <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>
              対象ユーザーには「本人にだけ通常通り見える」が、他人の目には投稿・コメント・スレ返信が映らなくなります。
              凍結 (suspend) より検知が遅れるためスパマー対策として有効です。
            </Text>
          </View>
        </View>

        {/* ============ 検索 ============ */}
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          <SectionLabel label="ユーザー検索" />
          <SearchInput value={query} onChange={setQuery} placeholder="ニックネームで検索…" />
        </View>

        {/* ============ 検索結果 ============ */}
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          {searchQuery.isLoading ? (
            <View style={{ padding: SP['8'], alignItems: 'center' }}>
              <Spinner />
            </View>
          ) : searchQuery.error ? (
            <ErrorBlock
              message="検索に失敗しました"
              onRetry={() => void searchQuery.refetch()}
            />
          ) : searchList.length === 0 ? (
            <EmptyBlock
              emoji={debouncedQuery.length > 0 ? '🔍' : '📭'}
              label={
                debouncedQuery.length > 0
                  ? '一致するユーザーが見つかりません'
                  : 'まだユーザーがいません'
              }
            />
          ) : (
            searchList.map((u, i) => (
              <UserRow
                key={u.id}
                user={u}
                busy={
                  toggle.isPending &&
                  toggle.variables?.id === u.id
                }
                onOpen={() => router.push(`/admin/user/${u.id}` as never)}
                onToggle={() => onTogglePress(u)}
                index={i}
              />
            ))
          )}
        </View>

        {/* ============ 現在 ban 中 ============ */}
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          <SectionLabel
            label="現在 Shadowban 中"
            count={bannedList.length}
          />
          {bannedQuery.isLoading ? (
            <View style={{ padding: SP['6'], alignItems: 'center' }}>
              <Spinner />
            </View>
          ) : bannedQuery.error ? (
            <ErrorBlock
              message="一覧を取得できませんでした"
              onRetry={() => void bannedQuery.refetch()}
            />
          ) : bannedList.length === 0 ? (
            <EmptyBlock emoji="✨" label="Shadowban 中のユーザーはいません" />
          ) : (
            bannedList.map((u, i) => (
              <UserRow
                key={u.id}
                user={u}
                busy={
                  toggle.isPending &&
                  toggle.variables?.id === u.id
                }
                onOpen={() => router.push(`/admin/user/${u.id}` as never)}
                onToggle={() => onTogglePress(u)}
                index={i}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* 確認 dialog (誤操作防止) */}
      <ConfirmDialog
        visible={pending !== null}
        title={pending?.banned ? 'Shadowban する' : 'Shadowban 解除'}
        message={
          pending
            ? pending.banned
              ? `「${pending.user.nickname ?? pending.user.id}」を Shadowban します。\n\n本人には何も変わらず見えますが、他のユーザーには投稿が一切表示されなくなります。`
              : `「${pending.user.nickname ?? pending.user.id}」の Shadowban を解除し、通常表示に戻します。`
            : ''
        }
        confirmLabel={pending?.banned ? 'Shadowban する' : '解除する'}
        destructive={pending?.banned}
        onConfirm={confirmToggle}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

// ============================================================
// SectionLabel
// ============================================================
function SectionLabel({ label, count }: { label: string; count?: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingBottom: SP['1'],
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: '800',
          color: C.text3,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
      {typeof count === 'number' && (
        <View
          style={{
            minWidth: 24,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: R.full,
            backgroundColor: count > 0 ? C.redBg : C.bg3,
            borderWidth: 1,
            borderColor: count > 0 ? C.red + '55' : C.border,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '800',
              color: count > 0 ? C.red : C.text3,
            }}
          >
            {count}
          </Text>
        </View>
      )}
    </View>
  );
}

// ============================================================
// SearchInput
// ============================================================
function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: C.border,
        paddingHorizontal: SP['3'],
      }}
    >
      <Icon.search size={16} color={C.text3} strokeWidth={2.2} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.text3}
        autoCapitalize="none"
        autoCorrect={false}
        // memory DoS 対策 (admin/index.tsx の SearchInput と同じ)
        maxLength={200}
        style={[T.body, { color: C.text, flex: 1, paddingVertical: 10 }]}
      />
      {value.length > 0 && (
        <PressableScale
          onPress={() => onChange('')}
          haptic="tap"
          hitSlop={10}
          style={{ padding: 4 }}
          accessibilityLabel="クリア"
        >
          <Icon.close size={14} color={C.text3} strokeWidth={2.4} />
        </PressableScale>
      )}
    </View>
  );
}

// ============================================================
// UserRow — 1 ユーザー行 (avatar + name + state + shadowban toggle)
// ============================================================
function UserRow({
  user,
  busy,
  onOpen,
  onToggle,
  index,
}: {
  user: AdminUser;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
  index: number;
}) {
  const isBanned = user.shadowbanned === true;
  const displayName = user.nickname ?? '(no nickname)';
  const isSuspended = user.account_state === 'suspended';

  return (
    <Animated.View
      entering={FadeInDown.duration(220).delay(Math.min(index, 8) * 20)}
      layout={Layout.springify()}
      style={[
        {
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: isBanned ? C.red + '55' : C.border,
          // banned 時は左に薄い赤帯
          borderLeftWidth: isBanned ? 3 : 1,
          borderLeftColor: isBanned ? C.red : C.border,
          gap: SP['2'],
        },
        SHADOW.card,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <UserAvatar name={displayName} muted={isBanned} />
        <View style={{ flex: 1, gap: 4 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              flexWrap: 'wrap',
            }}
          >
            <Text
              style={[T.bodyB, { color: isBanned ? C.text3 : C.text, flexShrink: 1 }]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            {user.is_admin && <RoleBadge label="ADMIN" color={C.accentLight} bg={C.accentBg} />}
            {isBanned && <RoleBadge label="SHADOW" color={C.red} bg={C.redBg} />}
            {isSuspended && <RoleBadge label="凍結中" color={C.text3} bg={C.bg3} />}
          </View>
          <View style={{ flexDirection: 'row', gap: SP['4'], flexWrap: 'wrap' }}>
            <Stat label="投稿" value={String(user.post_count)} />
            <Stat label="信頼" value={String(user.trust_score)} />
            <Stat
              label="通報"
              value={String(user.concern_received_count)}
              accent={user.concern_received_count > 0 ? C.red : undefined}
            />
          </View>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          gap: SP['2'],
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <ActionPill label="詳細" tone="neutral" onPress={onOpen} />
        <ActionPill
          label={isBanned ? 'Shadowban 解除' : 'Shadowban'}
          tone={isBanned ? 'amber' : 'danger'}
          onPress={onToggle}
          busy={busy}
        />
      </View>
    </Animated.View>
  );
}

// シンプルな avatar (admin/index.tsx の UserAvatar と同じパターン)
function UserAvatar({ name, muted }: { name: string; muted?: boolean }) {
  const code = (name.charCodeAt(0) || 0) % 4;
  const colors: ReadonlyArray<readonly [string, string]> = [
    [C.accent, C.accentDeep],
    [C.pink, C.accent],
    [C.blue, C.accentDeep],
    [C.amber, C.red],
  ];
  const pair = colors[code] ?? colors[0]!;
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <LinearGradient
      colors={pair as unknown as readonly [string, string, ...string[]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: 40,
        height: 40,
        borderRadius: R.full,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: muted ? 0.55 : 1,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{initial}</Text>
    </LinearGradient>
  );
}

function RoleBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View
      style={{
        paddingHorizontal: SP['2'],
        paddingVertical: 1,
        backgroundColor: bg,
        borderRadius: R.sm,
        borderWidth: 1,
        borderColor: color + '55',
      }}
    >
      <Text style={{ fontSize: 11, color, fontWeight: '800', letterSpacing: 0.5 }}>{label}</Text>
    </View>
  );
}

// ============================================================
// ActionPill (admin/index.tsx の ActionButton と同コンセプト)
// ============================================================
type ActionTone = 'neutral' | 'accent' | 'danger' | 'amber';
const ACTION_PALETTE: Record<ActionTone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: C.text, bg: C.bg3, border: C.border },
  accent: { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  danger: { fg: C.red, bg: C.redBg, border: C.red + '55' },
  amber: { fg: C.amber, bg: C.amberBg, border: C.amber + '55' },
};

function ActionPill({
  label,
  tone = 'neutral',
  onPress,
  busy,
}: {
  label: string;
  tone?: ActionTone;
  onPress: () => void;
  busy?: boolean;
}) {
  const p = ACTION_PALETTE[tone];
  return (
    <PressableScale
      onPress={onPress}
      haptic={tone === 'danger' ? 'warn' : 'tap'}
      disabled={busy}
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: 7,
        backgroundColor: p.bg,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: p.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: busy ? 0.6 : 1,
        ...(isWeb ? ({ cursor: 'pointer' } as object) : null),
      }}
    >
      {busy && <ActivityIndicator size="small" color={p.fg} />}
      <Text style={[T.smallB, { color: p.fg, fontSize: 12 }]}>{label}</Text>
    </PressableScale>
  );
}

// FadeIn import retained for future use (e.g., empty state polish)
void FadeIn;
