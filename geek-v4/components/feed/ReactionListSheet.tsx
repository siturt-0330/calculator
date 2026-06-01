// ============================================================
// ReactionListSheet — 投稿に押された「全テキストスタンプ」を見るシート
// ------------------------------------------------------------
// 投稿カードのリアクション行は上位 5 件 + 「…」だけ表示する。「…」をタップすると
// 本シートを開き、押された全スタンプ (meme + 件数) を一覧できる。各 chip はタップで
// 自分も押す/解除できる (自分の押下は accent でハイライト)。
// ※ 匿名 SNS なので「誰が押したか」は出さず、meme ごとの集計件数だけを見せる。
// ============================================================
import { Modal, View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import type { ReactionAgg } from '../../lib/api/reactions';

export function ReactionListSheet({
  visible,
  onClose,
  reactions,
  onReact,
}: {
  visible: boolean;
  onClose: () => void;
  /** 投稿に押された全スタンプの集計 (count 降順)。 */
  reactions: ReactionAgg[];
  /** chip タップでトグル (post の onReact をそのまま渡す)。 */
  onReact: (meme: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const total = reactions.reduce((a, r) => a + r.count, 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View
          style={{
            maxHeight: '75%',
            backgroundColor: C.bg2,
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['4'],
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: C.border,
            gap: SP['3'],
          }}
        >
          {/* ヘッダー */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 18 }}>🪶</Text>
            <Text style={[T.h4, { color: C.text, marginLeft: SP['1'], flex: 1 }]} numberOfLines={1}>
              リアクション {total}
            </Text>
            <PressableScale
              onPress={onClose}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="閉じる"
              style={{ padding: SP['2'], marginRight: -SP['2'] }}
            >
              <Icon.close size={24} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
          </View>

          <Text style={[T.caption, { color: C.text3 }]}>
            タップで自分も押す / 解除できます。
          </Text>

          <ScrollView contentContainerStyle={{ paddingBottom: SP['4'] }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {reactions.map((r) => (
                <PressableScale
                  key={r.meme}
                  onPress={() => onReact(r.meme)}
                  haptic="tap"
                  hitSlop={6}
                  accessibilityLabel={`${r.meme} ${r.count} 件 ${r.mine ? '(押下済み)' : ''}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 8,
                    backgroundColor: r.mine ? C.accentSoft : C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1.5,
                    borderColor: r.mine ? C.accent : C.border,
                  }}
                >
                  <Text style={{ fontSize: 13, color: r.mine ? C.accent : C.text, fontWeight: '700' }}>
                    {r.meme}
                  </Text>
                  <Text
                    style={{ fontSize: 12, color: r.mine ? C.accent : C.text3, fontWeight: '700' }}
                  >
                    {r.count}
                  </Text>
                </PressableScale>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
