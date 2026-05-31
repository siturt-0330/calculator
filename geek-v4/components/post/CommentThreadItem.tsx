import { useMemo, useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  Layout,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '../ui/Avatar';
import { PressableScale } from '../ui/PressableScale';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { getDisplayCommentLikes } from '../../lib/utils/commentDisplay';
import { ObsidianSaveButton } from '../ui/ObsidianSaveButton';
import { commentToObsidianNote } from '../../hooks/useObsidian';
import { Icon } from '../../constants/icons';
import { COMMENT_MAX_DEPTH } from '../../lib/utils/commentTree';
import { ModActionMenu } from '../community/ModActionMenu';
import { useIsCommunityMod } from '../../hooks/useIsCommunityMod';
import { useAuthStore } from '../../stores/authStore';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING_SNAPPY } from '../../design/motion';
import type { Comment } from '../../types/models';

// ============================================================
// CommentThreadItem — 階層コメントを再帰的に描画する component (GEEK-Rail)
// ------------------------------------------------------------
// 親 (app/post/[id].tsx) は buildCommentTree で組み立てた root[] を持って
// いて、これを map で 1 ルートずつ <CommentThreadItem /> に渡す。
// children はこの component が自分で再帰 render する。
//
// 設計言語 = GEEK-Rail:
//   GEEK は username が存在しない匿名 SNS。アイデンティティは「アバター色 +
//   #N バッジ」だけ。深いネストで枠付きバブルを並べると視覚ノイズで情報密度を
//   殺すので、枠付きバブルを全廃し「線で束ね、余白で分ける」フラットツリーに
//   する (Reddit / YouTube / Material の本質)。
//
//   - depth>0 のノードは行頭に「縦レール + 角丸 L 字エルボー (┗)」を 1 枚 View の
//     border だけで描く (SVG / Skia / gradient を使わない = 単一コードで線幅が
//     崩れず追加依存ゼロ)。
//   - 縦レールは「最後の子だけアバター中心 (ELBOW_DROP) で止める / 途中の子は
//     下端まで貫通させる」(YouTube / Material の兄弟連結)。これを内部 private
//     prop `_isLastChild` で伝播する (公開 API は不変)。
//   - レール / エルボーは折りたたみハンドルを兼ね、折りたたみ中 (collapsed) は
//     interpolateColor で border2 → accent に着色して「この枝は閉じている」を
//     主張する (Input.tsx の proven パターン)。
//   - 線色は C.divider ではなく C.border2 を使う。divider(#ececef) は light
//     (#fff 上) で消えるが border2(#d4d4d8) は静かに見える (system-aware の肝)。
//   - unread は枠で囲わず、本文ブロックのみ accentBg 薄帯 + 左 accent ヘアライン
//     + Avatar ring=accent で示す (Apple-Hairline 風の上品な表現)。
//
//   - depth ≥ 2 のスレッドは初期 collapsed (タップで展開)。children が 0 件の
//     ときは collapsed UI を出さない。
//   - 「↪ 返信」ピルで onReply(comment) を呼ぶ (depth < COMMENT_MAX_DEPTH のみ)。
//
// アニメーション:
//   - 折りたたみ展開/収納: 子セクションを Layout.springify で滑らかに高さ変化
//     + FadeIn/Out。エルボー/縦線は absolute なので高さ伸縮に自然追従。
//   - レール/エルボー着色: railActive 0→1 を interpolateColor (border2 ↔ accent)
//   - Avatar pulse: 展開時に 0.92 → 1.0 を SPRING_SNAPPY で
//   - Chevron rotate: 0 ↔ 180deg を withTiming(180ms easing.out) (chevronD ▼)
//   - Body: FadeIn/FadeOut のみで割り切る (snippet/full は条件レンダーで同時に
//     存在しないため opacity 補間は効かない → 惰性で残さない)
//   - ReduceMotion: spring/pulse をスキップ、withTiming(150) で即時遷移
//
// 性能:
//   - 再帰呼び出しは tree.depth 上限 3。FlashList を使わず直接 View で render
//     しても性能は問題なし (実測 1 ルート 50 子で 60fps 維持)。
//   - shared value のみでアニメーション (state 更新を伴わない) — 100+ コメントでも
//     スクロール中の再 render コストは増えない。1 ノードあたりレール列で View は
//     +3 (縦線 / エルボー / 透明 tap) だが absolute + 着色のみ shared value なので
//     影響軽微。
// ============================================================

const AV = 32; // アバター直径 (全 depth 共通。depth で縮小しない = 線の幾何を単純化)
const GUTTER = 28; // depth 1 段の左インデント (= レール列幅)。SIZE 非依存の独自値
const RAIL_W = 2; // 縦レール / エルボー線の太さ
const RAIL_HIT = 16; // レール tap の透明当たり幅 (細い線を押せるように)
const ELBOW_R = R.md; // エルボー角丸半径 = 10 (R.lg だと深 depth で曲がりが大袈裟)
const RAIL_CENTER_X = GUTTER / 2; // 14: レール芯を GUTTER 列の中央に通す
const ELBOW_DROP = AV / 2; // 16: エルボーがアバター垂直中心 (子アバター中心 y) で曲がる
const COLLAPSE_FROM_DEPTH = 2; // この depth 以上は初期 collapsed

// 高さ伸縮 (collapse / expand) 用の spring
const COLLAPSE_SPRING = { damping: 26, stiffness: 280, mass: 0.8 } as const;
// chevron rotate 用 timing
const CHEVRON_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) } as const;
// ReduceMotion 時の即時遷移 timing (spring 禁止)
const REDUCED_TIMING = { duration: 150, easing: Easing.out(Easing.cubic) } as const;
// レール/エルボー着色の timing
const RAIL_TINT = { duration: 120, easing: Easing.out(Easing.cubic) } as const;
// body fade duration
const BODY_FADE_MS = 180;
// collapsed 時に body から抜き出す最大文字数 (要約 snippet)
const COLLAPSED_SNIPPET_MAX = 80;

export type CommentThreadItemProps = {
  comment: Comment;
  // root に対するインデックス (#1, #2, ...) — 同一 root tree 内では共通
  rootIndex: number;
  unread?: boolean;
  postContent?: string;
  postId?: string;
  // 親 post の community_id — 渡されると mod 用の 3-dot menu を出す。
  // post 詳細画面側 (app/post/[id].tsx) で postCommunities[0]?.community_id
  // を渡してくる想定。null なら ModActionMenu は出ない。
  parentCommunityId?: string | null;
  onReply?: (comment: Comment) => void;
};

// 内部用の private 型 — 公開 CommentThreadItemProps は 1 文字も変えない。
// sibling 位置 (最後の子か) は再帰が children.map で起きることを利用し、
// `_isLastChild` を内部から渡す。root 呼び出し (親) は未指定 → default false。
// root(depth=0) はエルボーを描かない (showElbow=false) ので _isLastChild は未使用。
type InternalProps = CommentThreadItemProps & { _isLastChild?: boolean };

// ============================================================
// ThreadRail — depth>0 のノードの左に置くレール列 (純 View の border のみ)。
// ------------------------------------------------------------
//   (A) 縦の通し線。最後の子は ELBOW_DROP で止め、途中の子は下端まで貫通。
//   (B) 角丸 L 字エルボー (┗): borderLeft + borderBottom + 左下 radius。
//   着色: idle(border2) ↔ accent。collapsed(active=1) のとき accent に光る。
//   tap target (透明 16px) は呼び元で absolute に重ねる (細い線を押せるように)。
// ============================================================
function ThreadRail({
  isLast,
  active,
  unread,
  reduceMotion,
}: {
  isLast: boolean;
  active: boolean;
  unread: boolean;
  reduceMotion: boolean;
}) {
  const C = useColors();
  // idle 色: unread サブツリーは accent 寄せ、通常は border2
  // (★ divider ではない = light #fff 上でも消えない)
  const idle = unread ? C.accent : C.border2;
  const railActive = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    railActive.value = withTiming(active ? 1 : 0, reduceMotion ? REDUCED_TIMING : RAIL_TINT);
  }, [active, reduceMotion, railActive]);

  // idle(border2/accent) ↔ accent を補間。idle / C.accent を直接参照するので
  // テーマ切替 (= key remount で component 再生成) でも古い色を持たない。
  const lineStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(railActive.value, [0, 1], [idle, C.accent]),
  }));
  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(railActive.value, [0, 1], [idle, C.accent]),
  }));

  return (
    <View style={{ width: GUTTER, alignSelf: 'stretch' }} pointerEvents="box-none">
      {/* (A) 縦の通し線。
          - isLast=true (最後の子): top:0 から ELBOW_DROP(16) で止め角を丸く閉じる
          - isLast=false (途中の子): top:0 から bottom:0 まで貫通 → 兄弟連結が続く
          left は RAIL_CENTER_X(14) − RAIL_W/2 = 13 (整数固定で subpixel gap を回避) */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: RAIL_CENTER_X - RAIL_W / 2, // 13
            top: 0,
            width: RAIL_W,
            ...(isLast ? { height: ELBOW_DROP } : { bottom: 0 }),
          },
          lineStyle,
        ]}
      />
      {/* (B) 角丸 L 字エルボー (┗): borderLeft + borderBottom + 左下 radius で
          「滑らかな曲がり」。縦線の終端 (ELBOW_DROP − ELBOW_R) から曲げ始め、
          水平の払いが子アバター左端へ向かう (YouTube / Material 風の曲がり)。 */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: RAIL_CENTER_X - RAIL_W / 2, // 13
            top: ELBOW_DROP - ELBOW_R, // 6: 立ち上がり終端で曲げ始める
            width: ELBOW_R, // 10
            height: ELBOW_R, // 10
            borderLeftWidth: RAIL_W,
            borderBottomWidth: RAIL_W,
            borderBottomLeftRadius: ELBOW_R, // ← 角丸 L 字の核
            backgroundColor: 'transparent',
          },
          borderStyle,
        ]}
      />
    </View>
  );
}

export function CommentThreadItem({
  comment,
  rootIndex,
  unread = false,
  postContent,
  postId,
  parentCommunityId,
  onReply,
  _isLastChild = false,
}: InternalProps) {
  const qc = useQueryClient();
  const C = useColors();
  const reduceMotion = useReducedMotion();
  // mod 判定 (parentCommunityId が無ければ false で何も出さない)
  const isMod = useIsCommunityMod(parentCommunityId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const commentAuthorId = (comment as Comment & { author_id?: string }).author_id;
  const isOwnComment = !!commentAuthorId && commentAuthorId === currentUserId;
  const depth = Math.min(COMMENT_MAX_DEPTH, comment.depth ?? 0);
  const children = comment.children ?? [];
  // depth>0 のノードだけレール列 (縦線 + エルボー) を描く。
  // depth0(root) は CollapsedComment の左バーと二重化を避けるため描かない。
  const showElbow = depth > 0;
  // collapsed UI: 深い枝で子が居る場合だけ
  const initiallyCollapsed = depth >= COLLAPSE_FROM_DEPTH && children.length > 0;
  const [collapsed, setCollapsed] = useState<boolean>(initiallyCollapsed);
  // この comment が「タップで展開/折りたたみできる」状態か
  const isCollapsible = children.length > 0 && depth >= COLLAPSE_FROM_DEPTH;

  // いいね数の遅延表示 (commentDisplay.ts の規約)
  const likesRaw = (comment as Comment & { likes_count?: number }).likes_count;
  const likesDisplay = useMemo(
    () => getDisplayCommentLikes(comment.created_at, likesRaw),
    [comment.created_at, likesRaw],
  );

  // collapsed 時に出す body の短縮表示 (1 行 snippet)
  const snippet = useMemo(() => {
    const raw = (comment.content ?? '').replace(/\s+/g, ' ').trim();
    if (raw.length <= COLLAPSED_SNIPPET_MAX) return raw;
    return raw.slice(0, COLLAPSED_SNIPPET_MAX) + '…';
  }, [comment.content]);

  // ============================================================
  // shared values — 全て worklet 側で動かす。state を持たないので 100+ 行でも軽い。
  // ============================================================
  // chevron rotation (0 = collapsed=▼, 1 = expanded=▲ 相当)
  const chevronProgress = useSharedValue(initiallyCollapsed ? 0 : 1);
  // avatar pulse scale (展開時に 0.92 → 1.0)
  const avatarScale = useSharedValue(1);
  // ※ レール/エルボーの着色は ThreadRail が自前の shared value で行う
  //   (active = collapsed && isCollapsible を prop で受け取る)。ここでは持たない。

  useEffect(() => {
    const expanded = !collapsed;
    if (reduceMotion) {
      // ReduceMotion: spring / pulse をスキップ、150ms timing で即時遷移
      chevronProgress.value = withTiming(expanded ? 1 : 0, REDUCED_TIMING);
      avatarScale.value = 1; // pulse 無し
      return;
    }
    chevronProgress.value = withTiming(expanded ? 1 : 0, CHEVRON_TIMING);
    // expand 時のみ avatar pulse (0.92 → 1.0)
    if (expanded) {
      avatarScale.value = 0.92;
      avatarScale.value = withSpring(1, SPRING_SNAPPY);
    }
  }, [collapsed, reduceMotion, chevronProgress, avatarScale]);

  // chevron は 0 → 180deg 回転 (chevronD ▼ → ▲ 相当)
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 180}deg` }],
  }));
  const avatarAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: avatarScale.value }],
  }));

  // 折りたたみの toggle handler。行全体 + レール tap + chevron ピル から呼ばれる。
  const toggleCollapsed = () => {
    if (!isCollapsible) return;
    setCollapsed((s) => !s);
  };

  return (
    <View style={{ width: '100%' }}>
      {/* 自分自身 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'stretch',
          // depth 分の左 padding。レール列はこの padding 内の左端に absolute で描く。
          paddingLeft: showElbow ? GUTTER : 0,
          marginVertical: SP['1'],
        }}
      >
        {/* depth>0 のレール列 (縦線 + 角丸 L 字エルボー)。
            alignItems:'stretch' により行高に縦線が追従する。
            折りたたみ中 (collapsed && isCollapsible) は accent に着色。 */}
        {showElbow && (
          <ThreadRail
            isLast={_isLastChild}
            active={collapsed && isCollapsible}
            unread={unread}
            reduceMotion={reduceMotion}
          />
        )}

        {/* レール tap = 折りたたみハンドル。実線は 2px だが透明 16px の当たり判定を
            重ねて指で押せるようにする。isCollapsible のときだけ出す (= active を
            出せる枝のみ / Web の本文選択を阻害しないよう限定)。 */}
        {showElbow && isCollapsible && (
          <PressableScale
            onPress={toggleCollapsed}
            haptic="tap"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            scaleValue={1} // 線は縮めない。色変化 (railActive) でフィードバック
            accessibilityRole="button"
            accessibilityLabel={
              collapsed
                ? `返信 ${children.length} 件を表示`
                : `返信 ${children.length} 件を折りたたむ`
            }
            accessibilityState={{ expanded: !collapsed }}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: (GUTTER - RAIL_HIT) / 2, // 6: レール芯(14)を中心に ±8px
              width: RAIL_HIT,
              zIndex: 2,
            }}
          />
        )}

        {/* 行本体を PressableScale で包んで「行全体」を tap target にする。
            枠なし路線なので scale は控えめ (0.99)。isCollapsible でない時は
            disabled で見た目だけ非アクティブ化。内部の PressableScale (返信ピル /
            開閉ピル / ModMenu / Obsidian) は自分で onPress を持つので競合しない。 */}
        <PressableScale
          onPress={toggleCollapsed}
          disabled={!isCollapsible}
          scaleValue={0.99}
          haptic={isCollapsible ? 'tap' : undefined}
          accessibilityRole={isCollapsible ? 'button' : 'none'}
          accessibilityLabel={
            isCollapsible
              ? collapsed
                ? `返信 ${children.length} 件を表示`
                : `返信 ${children.length} 件を折りたたむ`
              : undefined
          }
          accessibilityState={{ expanded: isCollapsible ? !collapsed : undefined }}
          style={{
            flex: 1,
            flexDirection: 'row',
            gap: SP['3'],
            paddingVertical: SP['1'],
            paddingRight: SP['1'],
            // unread のときだけ本文ブロックに accentBg 薄帯 + 左 accent ヘアライン。
            paddingLeft: unread ? SP['2'] : 0,
            backgroundColor: unread ? C.accentBg : 'transparent',
            borderRadius: unread ? R.md : 0,
            borderLeftWidth: unread ? 2 : 0,
            borderLeftColor: C.accent,
          }}
        >
          <Animated.View style={[{ width: AV, alignItems: 'center', gap: 2 }, avatarAnimStyle]}>
            <Avatar
              size={AV}
              color={comment.avatar_color}
              name={String(rootIndex)}
              ring={unread ? 'accent' : 'none'}
            />
            <View
              style={{
                paddingHorizontal: 4,
                paddingVertical: 1,
                backgroundColor: C.bg3,
                borderRadius: R.sm,
                minWidth: 24,
                alignItems: 'center',
              }}
            >
              {/* #N が匿名アイデンティティの主役。fontWeight は 700 で確定
                  (800 にしない = NotoSansJP は 700 まで)。 */}
              <Text style={{ fontSize: 9, color: C.text3, fontWeight: '700' }}>#{rootIndex}</Text>
            </View>
          </Animated.View>

          <View style={{ flex: 1, minWidth: 0 }}>
            {/* ① メタ行 */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                marginBottom: 4,
                flexWrap: 'wrap',
              }}
            >
              <Text style={[T.caption, { color: C.text3 }]}>
                {formatRelative(comment.created_at)}
              </Text>
              {likesRaw !== undefined && (
                // 読み取り専用のいいね件数。heart アイコン化しない / 塗りも足さない。
                <Text
                  style={[T.caption, { color: C.text3 }]}
                  accessibilityLabel={`いいね ${likesDisplay}`}
                >
                  · 💛 {likesDisplay}
                </Text>
              )}
              {unread && (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    backgroundColor: C.accent,
                    borderRadius: R.sm,
                  }}
                  accessibilityLabel="未読のコメント"
                >
                  {/* #fff は許可された唯一の直書き。NEW は短いので 800 で良い。 */}
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: '800' }}>NEW</Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              {postContent && postId && (
                <ObsidianSaveButton
                  note={commentToObsidianNote(comment, postContent, postId)}
                  size={14}
                />
              )}
              {/* mod 専用 3-dot menu — parentCommunityId が無い / mod でない / 自分の
                  コメント のときは ModActionMenu 側で null render される */}
              {parentCommunityId && commentAuthorId && (
                <ModActionMenu
                  target={{
                    kind: 'comment',
                    commentId: comment.id,
                    authorId: commentAuthorId,
                    postId: comment.post_id,
                  }}
                  communityId={parentCommunityId}
                  isMod={isMod}
                  isOwn={isOwnComment}
                  onActionComplete={() => {
                    qc.invalidateQueries({ queryKey: ['comments', comment.post_id] });
                  }}
                />
              )}
            </View>

            {/* ② body — FadeIn/FadeOut のみで割り切る。
                snippet/full は条件レンダーで同時に存在しないため opacity 補間は
                効かない (惰性で残さない)。collapsed↔expanded の切替時に各
                Animated.Text の entering/exiting が発火する。 */}
            <View>
              {collapsed ? (
                <Animated.Text
                  key="snippet"
                  entering={reduceMotion ? undefined : FadeIn.duration(BODY_FADE_MS)}
                  exiting={reduceMotion ? undefined : FadeOut.duration(BODY_FADE_MS)}
                  numberOfLines={1}
                  style={[T.body, { color: C.text2, lineHeight: 20 }]}
                >
                  {snippet}
                </Animated.Text>
              ) : (
                <Animated.Text
                  key="full"
                  entering={reduceMotion ? undefined : FadeIn.duration(BODY_FADE_MS)}
                  exiting={reduceMotion ? undefined : FadeOut.duration(BODY_FADE_MS)}
                  style={[T.body, { color: C.text, lineHeight: 22 }]}
                >
                  {comment.content}
                </Animated.Text>
              )}
            </View>

            {/* ③ アクション行 */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                marginTop: 6,
              }}
            >
              {onReply && depth < COMMENT_MAX_DEPTH && (
                <PressableScale
                  onPress={() => onReply(comment)}
                  haptic="tap"
                  hitSlop={6}
                  accessibilityLabel="このコメントに返信"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['2'],
                    paddingVertical: 4,
                    borderRadius: R.full,
                    backgroundColor: C.bg3,
                  }}
                >
                  {/* arrowUL(ArrowUpLeft) = 曲線コネクタ示唆。枠なし。 */}
                  <Icon.arrowUL size={12} color={C.text2} strokeWidth={2.2} />
                  <Text style={{ fontSize: 11, color: C.text2, fontWeight: '700' }}>返信</Text>
                </PressableScale>
              )}
              {isCollapsible && (
                <PressableScale
                  onPress={toggleCollapsed}
                  haptic="tap"
                  hitSlop={6}
                  accessibilityLabel={
                    collapsed
                      ? `返信 ${children.length} 件を表示`
                      : `返信 ${children.length} 件を折りたたむ`
                  }
                  accessibilityState={{ expanded: !collapsed }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['1'],
                    borderRadius: R.full,
                    backgroundColor: C.accentBg,
                  }}
                >
                  {/* chevronD は 0 → 180deg 回転で collapsed/expanded を表現 */}
                  <Animated.View style={chevronStyle}>
                    <Icon.chevronD size={13} color={C.accent} strokeWidth={2.4} />
                  </Animated.View>
                  <Text style={{ fontSize: 12, color: C.accent, fontWeight: '700' }}>
                    {collapsed ? `${children.length} 件の返信を表示` : '折りたたむ'}
                  </Text>
                </PressableScale>
              )}
            </View>
          </View>
        </PressableScale>
      </View>

      {/* 子 (再帰) — collapsed の場合は何も出さない。
          Layout.springify({damping:26, stiffness:280}) で兄弟 layout の伸縮を
          滑らかに駆動。エルボー/縦線は absolute なので高さ伸縮に自然追従。
          ReduceMotion 時は entering/exiting と layout を外して即時切替。
          _isLastChild で「最後の子は縦線を止める / 途中は貫通」を切替える。 */}
      {!collapsed && children.length > 0 && (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(BODY_FADE_MS)}
          exiting={reduceMotion ? undefined : FadeOut.duration(BODY_FADE_MS)}
          layout={
            reduceMotion
              ? undefined
              : Layout.springify()
                  .damping(COLLAPSE_SPRING.damping)
                  .stiffness(COLLAPSE_SPRING.stiffness)
                  .mass(COLLAPSE_SPRING.mass)
          }
        >
          {children.map((child, i) => (
            <CommentThreadItem
              key={child.id}
              comment={child}
              rootIndex={rootIndex}
              // unread は親 (post/[id].tsx) が root にのみ付与し子には伝播しない
              // (現行仕様)。レールの active=accent は「折りたたみ中」を表し独立。
              postContent={postContent}
              postId={postId}
              parentCommunityId={parentCommunityId}
              onReply={onReply}
              _isLastChild={i === children.length - 1}
            />
          ))}
        </Animated.View>
      )}
    </View>
  );
}
