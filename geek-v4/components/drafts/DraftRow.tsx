// =====================================================================
// DraftRow — 下書き一覧の一行(EDITORIAL「特集」言語 / 未製本の草稿束)
// 誌面の索引行: 上 hairline、左に種別票(細罫円)+ 種別ラベル、
// 中央に導出タイトル + 更新時刻、右に削除(close)と chevronR。
// 塗りなし・罫線と余白のみ。種別差は塗りでなくアイコンで黙って区別する。
// presentational: draft / onPress(再開) / onDelete を props で受ける。
// 導出タイトルは UI 側で必ずガード(noUncheckedIndexedAccess 配慮)。
// =====================================================================
import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { C, SP, R } from "../../design/tokens";
import { T, FONT } from "../../design/typography";
import { PressableScale } from "../ui/PressableScale";
import { Icon, type IconName } from "../../constants/icons";
import { type Draft } from "../../stores/draftsStore";
import { formatRelative } from "../../lib/utils/date";

// 公開設定 → アイコンの対応(community 下書きのメタ先頭に添える)
const VISIBILITY_ICON: Record<"open" | "request" | "invite", IconName> = {
  open: "globe",
  request: "lock",
  invite: "shield",
};

// 下書き種別 → タイトルの導出(UI 側ガード)。
// post: title || content の1行目 || "無題の投稿"
// community: name || "無題のコミュニティ"
function deriveTitle(draft: Draft): string {
  if (draft.kind === "post") {
    const fromTitle = draft.title?.trim();
    if (fromTitle) return fromTitle;
    // split[0] は string | undefined。?? '' でガードしてから trim。
    const firstLine = (draft.content?.split("\n")[0] ?? "").trim();
    return firstLine || "無題の投稿";
  }
  return draft.name?.trim() || "無題のコミュニティ";
}

export function DraftRow({
  draft,
  onPress,
  onDelete,
}: {
  draft: Draft;
  onPress: () => void;
  onDelete: () => void;
}) {
  const reduce = useReducedMotion();

  const title = deriveTitle(draft);
  const isCommunity = draft.kind === "community";
  const kindLabel = isCommunity ? "コミュニティ" : "投稿";
  // 種別票の中身: community=community / post=comment(吹き出し)
  const kindIcon: IconName = isCommunity ? "community" : "comment";
  // 更新時刻: updatedAt は number なので必ず toISOString 化してから渡す。
  const updatedLabel = formatRelative(new Date(draft.updatedAt).toISOString());
  // 動的キーは Icon マップから解決してから JSX で使う(Icon は name-prop 非対応)。
  const KindIcon = Icon[kindIcon];
  // 公開設定アイコンは community 下書きのみ。kind で絞ってから visibility を引く。
  const VIcon =
    draft.kind === "community" ? Icon[VISIBILITY_ICON[draft.visibility]] : null;

  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.duration(220)}>
      <PressableScale
        onPress={onPress}
        haptic="tap"
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel="下書きを開く"
      >
        {/* 左: 種別票(細罫円・蔵書票96の縮小エコー) */}
        <View style={styles.badge}>
          <KindIcon size={18} color={C.text2} />
        </View>

        {/* 中央: 導出タイトル + メタ(種別 / 公開設定 / 更新時刻) */}
        <View style={styles.center}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.meta}>
            {VIcon && (
              <VIcon size={11} color={C.text4} />
            )}
            <Text style={styles.metaText}>{kindLabel}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{updatedLabel}</Text>
          </View>
        </View>

        {/* 右: 削除(close 流用)+ 遷移示唆(chevronR) */}
        <PressableScale
          onPress={onDelete}
          haptic="warn"
          hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
          accessibilityRole="button"
          accessibilityLabel="削除"
        >
          <Icon.close size={16} color={C.text4} />
        </PressableScale>
        <Icon.chevronR size={18} color={C.text3} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP[3],
    paddingVertical: SP[4],
    paddingHorizontal: SP[5],
    // 上 hairline(誌面の索引行)
    borderTopWidth: 1,
    borderTopColor: C.divider,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: R.full,
    borderWidth: 1,
    borderColor: C.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1 },
  title: { ...T.h4, fontFamily: FONT.jpB, color: C.text },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP[1],
    marginTop: SP[1],
  },
  metaText: { ...T.caption, color: C.text3 },
  metaDot: { ...T.caption, color: C.text4 },
});
