// =============================================================================
// app/drafts/index.tsx — 下書き一覧画面(ドロワー「下書き」→ ここで再開 / 削除)
// -----------------------------------------------------------------------------
// EDITORIAL「特集」言語の目録(カタログ)画面。黒地 C.bg + 1px 罫線 +
// 大型タイポ。塗りカード/濃い影は使わず、罫線と余白でリズムを作る。
//
//   - マウント時に下書きストアを 1 回だけ hydrate(getState 経由・購読しない)。
//     items は selector(useDraftsStore((s)=>s.items))で購読し、変更で再描画。
//   - ヘッダは EditorialFormHeader(titleEn="DRAFTS" / titleJa="下書き")。
//     戻る導線は router.back()。ヘッダは自前で左右 SP[5] を持つので本画面では
//     横 padding を二重に与えない(行/空状態/全削除リンクが各自 SP[5] を持つ)。
//   - items 0 件 → DraftsEmpty(onBrowse で投稿作成へ)。
//   - 1 件以上 → ScrollView で DraftRow を列挙。各行:
//       onPress = 再開(kind で post/community の create へ draftId 付き遷移)
//       onDelete = ストアから即削除(確認ダイアログ無し / haptic は行側=warn)
//   - 末尾に「すべて削除」リンク(誌面調・上 hairline・Icon.close + 灰文字 /
//     PressableScale haptic="warn" → ストア clear)。
//   - 背景 C.bg、下 padding は insets.bottom + SP[10]。
//
// presentational 部品(DraftRow / DraftsEmpty / EditorialFormHeader)は別途
// 実装済み。本画面は router / store / SafeArea を担う唯一の「画面」層。
// =============================================================================

import { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';
import { useDraftsStore } from '../../stores/draftsStore';
import { EditorialFormHeader } from '../../components/community/EditorialFormHeader';
import { DraftsEmpty } from '../../components/drafts/DraftsEmpty';
import { DraftRow } from '../../components/drafts/DraftRow';

export default function DraftsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // items は selector で購読(変更で再描画)。
  const items = useDraftsStore((s) => s.items);

  // storage から復元は 1 回だけ。store の action は getState 経由で取り、
  // この effect 自体は再購読しない(多重 hydrate は store 側で no-op)。
  useEffect(() => {
    useDraftsStore.getState().hydrate();
  }, []);

  const isEmpty = items.length === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* マストヘッド(自前で左右 SP[5] を持つ / 最下辺 hairline=目録の開始) */}
      <EditorialFormHeader titleEn="DRAFTS" titleJa="下書き" onBack={() => router.back()} />

      {isEmpty ? (
        // 空状態(白紙の見開き)。DraftsEmpty が自前で左右 SP[5]・上余白を持つ。
        <DraftsEmpty onBrowse={() => router.push('/post/create')} />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP[10] }}
          showsVerticalScrollIndicator={false}
        >
          {/* 目録束: 各行は自前で上 hairline と左右 SP[5] を持つ */}
          {items.map((draft) => (
            <DraftRow
              key={draft.id}
              draft={draft}
              onPress={() => {
                // 再開: 種別で composer / community create へ draftId を渡して遷移。
                if (draft.kind === 'post') {
                  router.push(`/post/create?draftId=${draft.id}`);
                } else {
                  router.push(`/community/create?draftId=${draft.id}`);
                }
              }}
              // 即削除(確認ダイアログ無し)。haptic warn は DraftRow 側で発火。
              onDelete={() => useDraftsStore.getState().remove(draft.id)}
            />
          ))}

          {/* すべて削除(誌面調リンク・上 hairline で目録束の終端から区切る) */}
          <PressableScale
            onPress={() => useDraftsStore.getState().clear()}
            haptic="warn"
            accessibilityRole="button"
            accessibilityLabel="すべての下書きを削除"
            style={styles.clearAll}
          >
            <Icon.close size={14} color={C.text3} />
            <Text style={styles.clearAllLabel}>すべて削除</Text>
          </PressableScale>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: {
    flex: 1,
  },
  // 全削除リンク: 行束の下に上 hairline で区切って静かに置く。
  // 行/ヘッダと版面左端を揃えるため自前で左右 SP[5] を持つ。
  clearAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
    marginTop: SP[5],
    paddingTop: SP[4],
    paddingHorizontal: SP[5],
    borderTopWidth: 1,
    borderTopColor: C.divider,
  },
  clearAllLabel: {
    ...T.smallM,
    color: C.text3,
  },
});
