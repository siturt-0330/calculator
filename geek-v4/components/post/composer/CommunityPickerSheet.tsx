// ============================================================
// CommunityPickerSheet — 投稿先コミュニティを選ぶ bottom sheet (複数選択)
// ------------------------------------------------------------
// X (Twitter) の audience picker + Reddit の community picker を融合した、
// 参加中コミュニティへのマルチセレクト sheet。検索欄でフィルタしつつ、
// 各行をタップして選択をトグルする。
//
// 設計判断:
//   - React Native Modal + Reanimated 3 (FadeIn/FadeOut backdrop +
//     SlideInDown/SlideOutDown panel)。既存 TagPickerSheet と同じ pattern
//     (@gorhom/bottom-sheet 不要 — 親の visible state だけで開閉)。
//   - 純粋な presentational component:
//       * データ (communities) は props
//       * 検索文字列 (query) と選択 (selectedIds) は親が所有 (controlled)
//       * supabase / zustand / navigation は一切持たない
//   - filtering: 自己完結のため query で *ローカルにも* 名前一致フィルタする
//     (case-insensitive)。親は query/onQueryChange で文字列を握り続ける。
//   - アイコン描画は CommunityPill / CommunityBigCard に揃える:
//       icon_url → ProgressiveImage(round) / 無ければ icon_color 円 + icon_emoji
//   - dark / light どちらでも見えるよう useColors() で配色。白背景は使わない。
// ============================================================

import { useMemo } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../../hooks/useColors';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { hap } from '../../../design/haptics';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../ui/PressableScale';
import { Input } from '../../ui/Input';
import { ProgressiveImage } from '../../ui/ProgressiveImage';
import { formatCountJa } from '../../../lib/format/communityMetrics';
import type { Community } from '../../../lib/api/communities';

// ============================================================
// props
// ============================================================

export interface CommunityPickerSheetProps {
  /** sheet の表示状態 (親が制御) */
  visible: boolean;
  /** backdrop / × / Android back で閉じる */
  onClose: () => void;
  /** 表示候補のコミュニティ一覧 (親が query で絞っていてもよい) */
  communities: Community[];
  /** 選択中コミュニティの id 配列 */
  selectedIds: string[];
  /** 行タップで id の選択をトグルする */
  onToggle: (id: string) => void;
  /** ロード中 (スケルトン / スピナー表示) */
  loading?: boolean;
  /** 検索文字列 (親が所有) */
  query: string;
  /** 検索文字列の変更 */
  onQueryChange: (q: string) => void;
}

const AVATAR = 36;
/** リストの最大高さ (panel maxHeight 内で list だけスクロールさせる) */
const LIST_MAX_HEIGHT = 420;
/** loading 時に出すスケルトン行の本数 */
const SKELETON_ROWS = 5;

// ============================================================
// CommunityPickerSheet
// ============================================================

export function CommunityPickerSheet({
  visible,
  onClose,
  communities,
  selectedIds,
  onToggle,
  loading = false,
  query,
  onQueryChange,
}: CommunityPickerSheetProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();

  // 選択判定を O(1) にする Set。selectedIds が変わった時だけ作り直す。
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // 自己完結フィルタ — 親が既に絞っていても、name 部分一致で二重に絞る
  // (case-insensitive)。trim した query が空なら全件。
  const trimmedQuery = query.trim();
  const filtered = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    if (q.length === 0) return communities;
    return communities.filter((c) => c.name.toLowerCase().includes(q));
  }, [communities, trimmedQuery]);

  // 空状態の出し分け:
  //   - communities 自体が空        → 参加中コミュニティ無し
  //   - communities はあるが filtered 空 → 検索ヒット無し
  const hasAnyCommunity = communities.length > 0;
  const hasMatch = filtered.length > 0;

  const handleClose = () => {
    hap.tap();
    onClose();
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
    >
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          justifyContent: 'flex-end',
        }}
      >
        {/* backdrop — tap で閉じる */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          onPress={handleClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          <Animated.View
            entering={SlideInDown.duration(260)}
            exiting={SlideOutDown.duration(200)}
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R.xl,
              borderTopRightRadius: R.xl,
              borderTopWidth: 1,
              borderTopColor: C.border,
              paddingBottom: insets.bottom + SP['3'],
              maxHeight: '92%',
            }}
          >
            {/* ===== drag indicator ===== */}
            <View style={{ alignItems: 'center', paddingTop: SP['2'] }}>
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: C.text4,
                }}
              />
            </View>

            {/* ===== header (title + close) ===== */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: SP['5'],
                paddingTop: SP['3'],
                paddingBottom: SP['3'],
              }}
            >
              <Text style={[T.h3, { color: C.text, flex: 1 }]}>コミュニティを選択</Text>
              <Pressable
                onPress={handleClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="閉じる"
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: pressed ? C.bg4 : C.bg3,
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <Icon.close size={18} color={C.text2} strokeWidth={2.2} />
              </Pressable>
            </View>

            {/* ===== search input ===== */}
            <View style={{ paddingHorizontal: SP['5'], paddingBottom: SP['3'] }}>
              <Input
                icon={Icon.search}
                placeholder="コミュニティを検索"
                value={query}
                onChangeText={onQueryChange}
                maxLength={40}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>

            {/* ===== body: list / loading / empty ===== */}
            {loading ? (
              <LoadingState C={C} />
            ) : !hasAnyCommunity ? (
              <EmptyState C={C} message="参加中のコミュニティがありません" />
            ) : !hasMatch ? (
              <EmptyState
                C={C}
                message={`「${trimmedQuery}」に一致するコミュニティがありません`}
              />
            ) : (
              <ScrollView
                style={{ maxHeight: LIST_MAX_HEIGHT }}
                contentContainerStyle={{
                  paddingHorizontal: SP['4'],
                  paddingBottom: SP['2'],
                  gap: SP['1'],
                }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {filtered.map((community) => (
                  <CommunityRow
                    key={community.id}
                    community={community}
                    selected={selectedSet.has(community.id)}
                    onPress={() => {
                      hap.select();
                      onToggle(community.id);
                    }}
                    C={C}
                  />
                ))}
              </ScrollView>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

// ============================================================
// CommunityRow — 1 コミュニティ分の選択行
// ------------------------------------------------------------
// avatar + 名前 + メトリクス + (公式 / 非公開バッジ) + 右端 check indicator。
// 選択中は faint accentSoft bg + 右端を accent 塗りつぶし円 + check に。
// ============================================================
type CommunityRowProps = {
  community: Community;
  selected: boolean;
  onPress: () => void;
  // useColors() の戻り値を呼び元で 1 度だけ評価して行に渡す。
  C: ReturnType<typeof useColors>;
};

function CommunityRow({ community, selected, onPress, C }: CommunityRowProps) {
  const isOpen = community.visibility === 'open';

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`コミュニティ ${community.name}${selected ? ' を選択中' : ''}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingVertical: SP['2'],
        paddingHorizontal: SP['3'],
        borderRadius: R.lg,
        backgroundColor: selected ? C.accentSoft : 'transparent',
      }}
    >
      {/* avatar: 画像があれば優先、無ければ icon_color の円 + 絵文字 */}
      {community.icon_url ? (
        <ProgressiveImage
          uri={community.icon_url}
          width={AVATAR}
          height={AVATAR}
          radius={AVATAR / 2}
          thumbWidth={120}
        />
      ) : (
        <View
          style={{
            width: AVATAR,
            height: AVATAR,
            borderRadius: AVATAR / 2,
            backgroundColor: community.icon_color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 18 }}>{community.icon_emoji}</Text>
        </View>
      )}

      {/* 中央: 名前 + メトリクス */}
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* 名前行 (公式 / 非公開バッジ) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text numberOfLines={1} style={[T.bodyM, { color: C.text, flexShrink: 1 }]}>
            {community.name}
          </Text>
          {community.is_official ? <Icon.award size={14} color={C.accent} /> : null}
          {!isOpen ? <Icon.lock size={12} color={C.text3} /> : null}
        </View>

        {/* メトリクス行 */}
        <Text numberOfLines={1} style={[T.caption, { color: C.text3, marginTop: 2 }]}>
          {`${formatCountJa(community.member_count)} メンバー · ${formatCountJa(
            community.post_count,
          )} 投稿`}
        </Text>
      </View>

      {/* 右端: check indicator (selected = accent 塗り円 + check / 非 = 空リング) */}
      {selected ? (
        <View
          accessible={false}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: C.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.check size={16} color="#ffffff" strokeWidth={2.6} />
        </View>
      ) : (
        <View
          accessible={false}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: C.border2,
          }}
        />
      )}
    </PressableScale>
  );
}

// ============================================================
// LoadingState — スケルトン行を数本 + 中央スピナー
// ============================================================
function LoadingState({ C }: { C: ReturnType<typeof useColors> }) {
  return (
    <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['4'] }}>
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <View
          // skeleton は静的なプレースホルダで並び替えが起きないため index key で十分
          key={`community-skeleton-${i}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
            paddingVertical: SP['2'],
            paddingHorizontal: SP['3'],
          }}
        >
          <View
            style={{
              width: AVATAR,
              height: AVATAR,
              borderRadius: AVATAR / 2,
              backgroundColor: C.bg4,
            }}
          />
          <View style={{ flex: 1, gap: 6 }}>
            <View
              style={{ width: '55%', height: 12, borderRadius: 6, backgroundColor: C.bg4 }}
            />
            <View
              style={{ width: '35%', height: 10, borderRadius: 5, backgroundColor: C.bg3 }}
            />
          </View>
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP['2'], paddingTop: SP['3'] }}>
        <ActivityIndicator size="small" color={C.accent} />
        <Text style={[T.small, { color: C.text3 }]}>読み込み中…</Text>
      </View>
    </View>
  );
}

// ============================================================
// EmptyState — 参加コミュニティ無し / 検索ヒット無しの中央メッセージ
// ============================================================
function EmptyState({
  C,
  message,
}: {
  C: ReturnType<typeof useColors>;
  message: string;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: SP['10'],
        paddingHorizontal: SP['6'],
        gap: SP['3'],
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: C.bg3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon.community size={22} color={C.text3} strokeWidth={2} />
      </View>
      <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>{message}</Text>
    </View>
  );
}
