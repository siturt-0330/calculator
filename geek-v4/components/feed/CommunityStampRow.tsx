// ============================================================
// CommunityStampRow — 投稿カードの直下に出すコミュスタンプ行
// ============================================================
// AnonPostCard を改変せずに、その下にコミュ専用スタンプの集計 + トグル UI を
// 並列描画するためのコンポーネント。
//
// 仕様:
//   - 既に押された (= mine) スタンプは accent 色で count 強調
//   - 未押下のスタンプはグレーで、タップすると ON
//   - スタンプ一覧が空なら「+ コミュスタンプを作る」リンクのみ表示
//   - スタンプ管理画面へのリンクが常時末尾
//
// iOS-native ポリッシュ:
//   - useColors() でテーマトークン経由に切り替え (旧 import { C } from tokens は dark 固定だった)
//   - chip の角は full pill のまま、border を divider に揃えて hairline 化
//   - mine の active chip は accent 単色だと派手なので accentBg + accent text + accent border に
//   - letterSpacing -0.08 で SF Pro Text の自然な tracking
// ============================================================
import { memo } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import type { CommunityStamp, CommunityStampAgg } from '../../hooks/useCommunityStamps';

type Props = {
  // ★ 重要 (バグ修正): postId を props で受け取る。
  // 旧版は親で `onReact={(stampId) => handleStampReact(p.id, stampId)}` の
  // ように毎回新規 arrow を生成して closure で post.id を閉じ込めていたが、
  // memo の `prev.onReact !== next.onReact` ガード抜けや React の reconciliation
  // タイミングで「最初に紐付いた arrow function (= 別 post の id 入り)」が
  // chip の onPress closure に残るバグが発生していた。
  // 親には post.id 非依存の安定 handler (postId, stampId) を渡してもらう。
  postId: string;
  communityId: string;
  // 利用可能なスタンプ全件 (use_count desc)
  stamps: CommunityStamp[];
  // この投稿に対する集計
  reactions: CommunityStampAgg[];
  // 押下時 (postId, stampId)
  onReact: (postId: string, stampId: string) => void;
  // 現在 in-flight の stampId 群 (UI 上 disable する)
  pendingStampIds?: Set<string>;
};

// パフォーマンス監査: コミュ詳細 FeedTab で 1 post 状態変更 → 全 post の
// CommunityStampRow が再構成される問題。memo + shallow compare で post 単位 isolate。
function CommunityStampRowInner({
  postId,
  communityId,
  stamps,
  reactions,
  onReact,
  pendingStampIds,
}: Props) {
  const router = useRouter();
  const C = useColors();

  // 表示順:
  //   1. 既に反応がついているスタンプ (count desc)
  //   2. 末尾に「スタンプ管理」リンク (未使用スタンプは管理画面からのみ選択可)
  const reactedFirst = reactions; // 既に count desc ソート済

  if (stamps.length === 0) {
    // スタンプがまだ無い時はコンパクトに「作ろう」CTA だけ
    return (
      <View style={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: SP['2'] }}>
        <PressableScale
          onPress={() => router.push(`/community/${communityId}/stamps` as never)}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="コミュニティスタンプを作る"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: C.bg3,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.divider,
            borderStyle: 'dashed',
          }}
        >
          <Icon.sparkles size={13} color={C.text3} strokeWidth={2.2} />
          <Text
            style={[
              T.caption,
              { color: C.text3, fontWeight: '600', fontSize: 12, letterSpacing: -0.08 },
            ]}
          >
            コミュスタンプを作る
          </Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <View
      style={{
        paddingHorizontal: 18,
        paddingTop: 4,
        paddingBottom: SP['2'],
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {/* 反応済みを最初に
            UX 修正: chip の touch target が小さすぎる (旧版 h=23px) と
            ユーザーが「押しても反応しない」と感じる。padding を vertical:6 horizontal:10
            に拡大 + hitSlop:10 で実効タップ領域を ~44px に押し上げる。

            iOS-native: mine の active 状態は accent 単色ではなく、accentBg +
            accent text + accent border で「上品な強調」に。 */}
        {reactedFirst.map((r) => {
          const pending = pendingStampIds?.has(r.stamp.id);
          return (
            <PressableScale
              key={`r-${r.stamp.id}`}
              onPress={() => onReact(postId, r.stamp.id)}
              haptic="tap"
              hitSlop={10}
              disabled={pending}
              accessibilityLabel={`${r.stamp.label} ${r.count} 件`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 10,
                paddingVertical: 6,
                backgroundColor: r.mine ? C.accentBg : C.bg3,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: r.mine ? C.accent : C.divider,
                opacity: pending ? 0.6 : 1,
              }}
            >
              <Text
                style={[
                  T.caption,
                  {
                    color: r.mine ? C.accent : C.text,
                    fontWeight: '700',
                    fontSize: 12,
                    letterSpacing: -0.08,
                  },
                ]}
              >
                {r.stamp.label}
              </Text>
              <Text
                style={[
                  T.caption,
                  {
                    color: r.mine ? C.accent : C.text3,
                    fontWeight: '700',
                    fontSize: 11,
                    letterSpacing: -0.06,
                  },
                ]}
              >
                {r.count}
              </Text>
            </PressableScale>
          );
        })}

        {/* 管理画面リンク — スタンプ選択はここから */}
        <PressableScale
          onPress={() => router.push(`/community/${communityId}/stamps` as never)}
          haptic="tap"
          hitSlop={12}
          accessibilityLabel="スタンプを管理"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['2'],
            paddingVertical: 6,
            borderRadius: R.full,
          }}
        >
          <Icon.plus size={13} color={C.text3} strokeWidth={2.4} />
          <Text
            style={[
              T.caption,
              { color: C.text3, fontWeight: '600', fontSize: 11, letterSpacing: -0.06 },
            ]}
          >
            管理
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

// memo: stamps 配列は community 全体で共有なので長さ比較で OK。
// reactions は post-specific なので長さ + 各 stamp の count/mine 簡易比較。
// onReact は親で useCallback 化された安定参照を渡してもらう前提。
// postId は post 毎に違うので必ず比較する (これが旧版の closure バグの根本対策)。
export const CommunityStampRow = memo(CommunityStampRowInner, (prev, next) => {
  if (prev.postId !== next.postId) return false;
  if (prev.communityId !== next.communityId) return false;
  if (prev.onReact !== next.onReact) return false;
  if (prev.pendingStampIds !== next.pendingStampIds) return false;
  if (prev.stamps.length !== next.stamps.length) return false;
  if (prev.reactions.length !== next.reactions.length) return false;
  // reactions の中身が変わったか (集計値) を浅く比較
  for (let i = 0; i < prev.reactions.length; i++) {
    const a = prev.reactions[i];
    const b = next.reactions[i];
    if (!a || !b) return false;
    if (a.stamp.id !== b.stamp.id) return false;
    if (a.count !== b.count) return false;
    if (a.mine !== b.mine) return false;
  }
  return true;
});
