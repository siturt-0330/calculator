// ============================================================
// EditHistoryModal — 投稿の編集履歴を時系列で表示する modal
// ============================================================
// Reddit ガイド 2.11 章: ジャーナリズム的価値 + 事後改変による
// 誤情報拡散の抑制のため、投稿の過去版 (最新 3 版) を read-only で
// 公開する。
//
// レイアウト:
//   - ヘッダ: タイトル「編集履歴」+ 閉じる
//   - 「現在の内容」セクション (最上部) — currentContent を表示
//   - 「過去の版」セクション — 新しい順に最大 3 版
//     各版に edited_at (相対表記) + prev_content (read-only)
//
// 設計判断:
//   - ConfirmDialog と同じく Modal + Animated.View で fade + zoom in。
//     プロジェクトの modal 流儀を踏襲。
//   - 履歴本体は ScrollView で囲み、版が長いテキストでもスクロールで
//     読めるようにする。
//   - 履歴 0 件のときは「編集なし」とだけ表示 (UI が空にならないように)。
// ============================================================
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { usePostEditHistory } from '../../hooks/usePostEditHistory';
import { formatRelative } from '../../lib/utils/date';

type Props = {
  postId: string;
  currentContent: string;
  visible: boolean;
  onClose: () => void;
};

export function EditHistoryModal({ postId, currentContent, visible, onClose }: Props) {
  // enabled=visible で lazy fetch — modal が閉じている間は network を叩かない
  const { data, isLoading, isError } = usePostEditHistory(postId, visible);
  const edits = data ?? [];

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(160)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          alignItems: 'center',
          justifyContent: 'center',
          padding: SP['6'],
        }}
      >
        {/* 背景タップで dismiss */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="編集履歴を閉じる"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <Animated.View
          entering={ZoomIn.duration(220)}
          exiting={ZoomOut.duration(160)}
          style={{
            width: '100%',
            maxWidth: 520,
            maxHeight: '85%',
            backgroundColor: C.bg2,
            borderRadius: R.xl,
            borderWidth: 1,
            borderColor: C.border,
            ...SHADOW.card,
            overflow: 'hidden',
          }}
        >
          {/* ----- ヘッダ ----- */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: SP['5'],
              paddingVertical: SP['4'],
              borderBottomWidth: 1,
              borderBottomColor: C.divider,
            }}
          >
            <Text style={[T.h3, { color: C.text, fontWeight: '700' }]}>編集履歴</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              style={({ pressed }) => ({
                paddingHorizontal: SP['3'],
                paddingVertical: SP['1'],
                borderRadius: R.md,
                backgroundColor: pressed ? C.bg4 : C.bg3,
              })}
            >
              <Text style={[T.smallM, { color: C.text2 }]}>閉じる</Text>
            </Pressable>
          </View>

          {/* ----- 本体 ----- */}
          <ScrollView
            contentContainerStyle={{ padding: SP['5'], gap: SP['4'] }}
            showsVerticalScrollIndicator={false}
          >
            {/* 現在の内容 (最上部) */}
            <View>
              <Text style={[T.captionM, { color: C.accent, marginBottom: SP['2'] }]}>
                現在の内容
              </Text>
              <View
                style={{
                  backgroundColor: C.accentSoft,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.accent,
                  padding: SP['4'],
                }}
              >
                <Text style={[T.body, { color: C.text, lineHeight: 22 }]} selectable>
                  {currentContent}
                </Text>
              </View>
            </View>

            {/* loading / error / 空 / 履歴本体 */}
            {isLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: SP['6'] }}>
                <ActivityIndicator color={C.accent} />
              </View>
            ) : isError ? (
              <Text style={[T.body, { color: C.red, textAlign: 'center', paddingVertical: SP['4'] }]}>
                編集履歴の取得に失敗しました
              </Text>
            ) : edits.length === 0 ? (
              <Text
                style={[T.small, { color: C.text3, textAlign: 'center', paddingVertical: SP['4'] }]}
              >
                編集はありません
              </Text>
            ) : (
              <View style={{ gap: SP['3'] }}>
                <Text style={[T.captionM, { color: C.text2, marginBottom: SP['1'] }]}>
                  過去の版 ({edits.length})
                </Text>
                {edits.map((edit, idx) => (
                  <View
                    key={edit.id}
                    style={{
                      backgroundColor: C.bg3,
                      borderRadius: R.md,
                      borderWidth: 1,
                      borderColor: C.border,
                      padding: SP['4'],
                      gap: SP['2'],
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text style={[T.captionM, { color: C.text3 }]}>
                        {idx === 0 ? '直前の版' : `${idx + 1} つ前の版`}
                      </Text>
                      <Text style={[T.caption, { color: C.text3 }]}>
                        {formatRelative(edit.edited_at)}
                      </Text>
                    </View>
                    <Text style={[T.body, { color: C.text2, lineHeight: 22 }]} selectable>
                      {edit.prev_content}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
