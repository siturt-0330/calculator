import { Redirect } from 'expo-router';

// オンボーディングは廃止 (登録は email+パスワードのみ・登録後そのままフィード)。
// 旧 5 画面 (index/language/nickname/liked-tags/notifications) は app 内ナビからは到達不能だが、
// Web の直 URL (/onboarding/*) で素画面が露出し得るため、この layout で常にフィードへ Redirect して
// 入口を塞ぐ。画面ファイルは harmless dead code として残置 (削除は別 PR・typed routes 再生成を伴う)。
export default function OnboardingLayout() {
  return <Redirect href="/(tabs)/feed" />;
}
