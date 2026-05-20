import { Stack } from 'expo-router';

// (tabs)/community/ 配下のスタック設定。
// すべての画面で下部の tab bar が見えるよう、stack screen の header だけ非表示にする。
// tab bar 自体は親の (tabs)/_layout.tsx が管理 — Expo Router が自動で重ねて描画する。
export default function CommunityStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
