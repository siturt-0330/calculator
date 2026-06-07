// ============================================================
// app/user/[id].tsx — 擬似名プロフィール (匿名のまま)
// ------------------------------------------------------------
// コメント/投稿のアバター・ハンドルをタップした時の遷移先。
//   ★ de-anon Phase2: route param [id] は author_id ではなく pseudonym_id トークン。
//     ハンドルは pseudonymFor(token) で決定的に導出し、アバター/投稿は
//     get_pseudo_profile_posts(token) RPC から取得する (author_id を client で扱わない)。
// 実名 (nickname) は一切出さず、「匿名ハンドル + 本人アバター」と、その人が公開した
// 投稿一覧 (server が is_public / community_public のみに絞る) を表示する。
// 匿名性は維持しつつ「同じ人」をたどれるようにする。
// ============================================================
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Avatar } from '../../components/ui/Avatar';
import { UserPostsList } from '../../components/mypage/UserPostsList';
import { supabase } from '../../lib/supabase';
import { pseudonymFor } from '../../lib/utils/pseudonym';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';

// 擬似プロフィールのヘッダ用アバター。get_pseudo_profile_posts は posts と一緒に
// 本人の avatar_url / avatar_emoji を返すので、それを 1 query で取得して表示に使う
// (author_id は返ってこない)。投稿一覧自体は UserPostsList が別 query で取得する。
async function fetchPseudoAvatar(
  token: string,
): Promise<{ avatar_url: string | null; avatar_emoji: string | null }> {
  const { data, error } = await supabase.rpc('get_pseudo_profile_posts', {
    p_pseudonym_id: token,
    p_limit: 1,
  });
  if (error) {
    console.warn('[PseudonymProfile] get_pseudo_profile_posts (avatar) error:', error.message);
    return { avatar_url: null, avatar_emoji: null };
  }
  const r = (data ?? null) as { avatar_url?: string | null; avatar_emoji?: string | null } | null;
  return { avatar_url: r?.avatar_url ?? null, avatar_emoji: r?.avatar_emoji ?? null };
}

export default function PseudonymProfileScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  // route param は pseudonym_id トークン (NOT author_id)。
  const token = typeof params.id === 'string' ? params.id : '';
  const pseudo = pseudonymFor(token);

  const { data: avatar } = useQuery({
    queryKey: ['pseudo-avatar', token],
    queryFn: () => fetchPseudoAvatar(token),
    enabled: !!token,
    staleTime: 60_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title={pseudo.handle} left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
        showsVerticalScrollIndicator={false}
      >
        {/* ヘッダー: 擬似名 + 本人アバター (実名なし)。アバターは RPC 由来、
            無ければ pseudonym の色/頭文字にフォールバック。 */}
        <View style={{ alignItems: 'center', paddingVertical: SP['6'], gap: SP['2'] }}>
          <Avatar
            size={72}
            uri={avatar?.avatar_url ?? undefined}
            emoji={avatar?.avatar_emoji ?? undefined}
            color={pseudo.color}
            name={pseudo.initial}
          />
          <Text style={[T.h2, { color: C.text }]}>{pseudo.handle}</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            匿名ユーザー · 公開した投稿のみ表示されます
          </Text>
        </View>

        {/* 公開投稿一覧 (server が is_public / community_public のみに絞る) */}
        <UserPostsList
          subject={token ? { kind: 'pseudonym', token } : undefined}
          emptyHint="まだ公開した投稿はありません"
        />
      </ScrollView>
    </View>
  );
}
