// ============================================================
// app/settings/blocked-users.tsx — ブロックしたユーザー
// ------------------------------------------------------------
// 設定 →「ブロックしたユーザー」の遷移先。
// ※ タグのブロック管理は別画面 (settings/blocked-tags) に集約済み。
//   以前はこの画面が誤ってタグ一覧を表示していた (ラベルと中身の不一致) ため、
//   ユーザーブロック専用の素直な画面に統一した。ユーザーブロック機能の実体が
//   入るまでは空状態のプレースホルダ。
// ============================================================

import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { C, SP } from '../../design/tokens';
import { Icon } from '../../constants/icons';

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="ブロックしたユーザー" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          flexGrow: 1,
          justifyContent: 'center',
        }}
      >
        <EmptyState
          icon={Icon.block}
          title="ブロックしたユーザーはいません"
          message="ブロックした相手は、ここに表示されます。"
        />
      </ScrollView>
    </View>
  );
}
