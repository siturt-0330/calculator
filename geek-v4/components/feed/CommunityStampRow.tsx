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
// ============================================================
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import type { CommunityStamp, CommunityStampAgg } from '../../hooks/useCommunityStamps';

type Props = {
  communityId: string;
  // 利用可能なスタンプ全件 (use_count desc)
  stamps: CommunityStamp[];
  // この投稿に対する集計
  reactions: CommunityStampAgg[];
  // 押下時 (stampId)
  onReact: (stampId: string) => void;
  // 現在 in-flight の stampId 群 (UI 上 disable する)
  pendingStampIds?: Set<string>;
};

export function CommunityStampRow({
  communityId,
  stamps,
  reactions,
  onReact,
  pendingStampIds,
}: Props) {
  const router = useRouter();

  // 集計済みの map
  const reactionByStampId = new Map<string, CommunityStampAgg>();
  for (const r of reactions) reactionByStampId.set(r.stamp.id, r);

  // 表示順:
  //   1. 既に反応がついているスタンプ (count desc)
  //   2. 残りのスタンプから use_count 降順で 6 個まで
  //   3. 末尾に「+ スタンプ管理」リンク
  const reactedSet = new Set(reactions.map((r) => r.stamp.id));
  const reactedFirst = reactions; // 既に count desc ソート済
  const remaining = stamps.filter((s) => !reactedSet.has(s.id)).slice(0, 6);

  if (stamps.length === 0) {
    // スタンプがまだ無い時はコンパクトに「作ろう」CTA だけ
    return (
      <View style={{ paddingHorizontal: SP['4'], paddingTop: 4, paddingBottom: SP['2'] }}>
        <PressableScale
          onPress={() => router.push(`/community/${communityId}/stamps` as never)}
          haptic="tap"
          hitSlop={6}
          accessibilityLabel="コミュニティスタンプを作る"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-start',
            paddingHorizontal: SP['2'],
            paddingVertical: 3,
            backgroundColor: C.bg3,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.border,
            borderStyle: 'dashed',
          }}
        >
          <Icon.sparkles size={11} color={C.text3} strokeWidth={2.2} />
          <Text style={[T.caption, { color: C.text3, fontWeight: '600', fontSize: 10 }]}>
            コミュスタンプを作る
          </Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <View
      style={{
        paddingHorizontal: SP['4'],
        paddingTop: 4,
        paddingBottom: SP['2'],
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {/* 反応済みを最初に */}
        {reactedFirst.map((r) => {
          const pending = pendingStampIds?.has(r.stamp.id);
          return (
            <PressableScale
              key={`r-${r.stamp.id}`}
              onPress={() => onReact(r.stamp.id)}
              haptic="tap"
              hitSlop={4}
              disabled={pending}
              accessibilityLabel={`${r.stamp.label} ${r.count} 件`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'],
                paddingVertical: 3,
                backgroundColor: r.mine ? C.accent : C.bg3,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: r.mine ? C.accent : C.border,
                opacity: pending ? 0.6 : 1,
              }}
            >
              <Text
                style={[
                  T.caption,
                  { color: r.mine ? '#fff' : C.text, fontWeight: '700', fontSize: 11 },
                ]}
              >
                {r.stamp.label}
              </Text>
              <Text
                style={[
                  T.caption,
                  {
                    color: r.mine ? '#fff' : C.text3,
                    fontWeight: '700',
                    fontSize: 10,
                  },
                ]}
              >
                {r.count}
              </Text>
            </PressableScale>
          );
        })}

        {/* まだ反応していないスタンプを 6 個まで提示 */}
        {remaining.map((s) => {
          const pending = pendingStampIds?.has(s.id);
          return (
            <PressableScale
              key={`s-${s.id}`}
              onPress={() => onReact(s.id)}
              haptic="tap"
              hitSlop={4}
              disabled={pending}
              accessibilityLabel={`${s.label} を押す`}
              style={{
                paddingHorizontal: SP['2'],
                paddingVertical: 3,
                backgroundColor: C.bg2,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: C.border,
                borderStyle: 'dashed',
                opacity: pending ? 0.6 : 1,
              }}
            >
              <Text
                style={[
                  T.caption,
                  { color: C.text2, fontWeight: '600', fontSize: 11 },
                ]}
              >
                {s.label}
              </Text>
            </PressableScale>
          );
        })}

        {/* 管理画面リンク */}
        <PressableScale
          onPress={() => router.push(`/community/${communityId}/stamps` as never)}
          haptic="tap"
          hitSlop={4}
          accessibilityLabel="スタンプを管理"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            paddingHorizontal: 6,
            paddingVertical: 3,
            borderRadius: R.full,
          }}
        >
          <Icon.plus size={11} color={C.text3} strokeWidth={2.4} />
          <Text style={[T.caption, { color: C.text3, fontWeight: '600', fontSize: 10 }]}>
            管理
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}
