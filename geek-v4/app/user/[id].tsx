// ============================================================
// app/user/[id].tsx — 擬似名プロフィール (匿名のまま)
// ------------------------------------------------------------
// コメント/投稿のアバター・ハンドルをタップした時の遷移先。
// 実名 (nickname) は一切出さず、author_id から導出した「匿名ハンドル + 色」と、
// その人が公開した投稿一覧 (UserPostsList = RLS で is_public のみ) を表示する。
// 匿名性は維持しつつ「同じ人」をたどれるようにする。
// ============================================================
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Avatar } from '../../components/ui/Avatar';
import { UserPostsList } from '../../components/mypage/UserPostsList';
import { pseudonymFor } from '../../lib/utils/pseudonym';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export default function PseudonymProfileScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const authorId = typeof params.id === 'string' ? params.id : '';
  const pseudo = pseudonymFor(authorId);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title={pseudo.handle} left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
        showsVerticalScrollIndicator={false}
      >
        {/* ヘッダー: 擬似名 + 色アバター (実名なし) */}
        <View style={{ alignItems: 'center', paddingVertical: SP['6'], gap: SP['2'] }}>
          <Avatar size={72} color={pseudo.color} name={pseudo.initial} />
          <Text style={[T.h2, { color: C.text }]}>{pseudo.handle}</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            匿名ユーザー · 公開した投稿のみ表示されます
          </Text>
        </View>

        {/* 公開投稿一覧 (RLS で is_public / community_public のみ返る) */}
        <UserPostsList authorId={authorId || undefined} emptyHint="まだ公開した投稿はありません" />
      </ScrollView>
    </View>
  );
}
