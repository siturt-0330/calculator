// ============================================================
// app/(tabs)/community/[id]/_layout.tsx
// ------------------------------------------------------------
// コミュニティ詳細配下の Stack レイアウト。
//
// 詳細 (index) + 4 サブタブ (bbs / map / calendar / admin) は
// それぞれ独立した route として登録される。サブタブ間の切替は
// 各画面が上部に持つ `CommunitySubTabs` chip → router.push で行う
// (Tabs in Tabs を避けて 親 (tabs)/_layout.tsx と衝突しないように)。
//
// header は全画面で非表示 (各画面が自前で TopBar + BackButton を描画)。
// ============================================================
import { Stack } from 'expo-router';

export default function CommunityIdStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
