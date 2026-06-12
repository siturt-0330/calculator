// ============================================================
// components/post/ReportSheet.tsx — 投稿を運営に通報する理由選択シート
// ------------------------------------------------------------
// フィード / コミュニティ / 投稿詳細から共通で使う。理由を選ぶと
// useReport 経由で public.reports に insert される (RLS: reporter=本人,
// unique(reporter_id, post_id) で重複は弾かれ「既に通報済み」表示)。
// 運営は admin 画面 (fetchReportedPosts) で reason 付きで確認できる。
//   props: visible / postId / onClose
// 自己完結 (useReport を内部で呼ぶ) なので各画面は postId と開閉だけ管理する。
// ============================================================

import { Modal, View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
// ★ 2026-06-12 P0-2: grabber を「引っ張れる契約」にする
import { SheetSwipeDown } from '../ui/SheetSwipeDown';
import { useColors } from '../../hooks/useColors';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useReport } from '../../hooks/useReport';

// reason は public.reports.reason (text) にそのまま保存する機械可読キー。
// 既存フィードの 'other' と互換。運営側でラベルへマップする。
const REASONS: { key: string; label: string }[] = [
  { key: 'spam', label: 'スパム・宣伝' },
  { key: 'harassment', label: '誹謗中傷・嫌がらせ' },
  { key: 'inappropriate', label: '不適切なコンテンツ（性的・暴力）' },
  { key: 'misinfo', label: '偽情報・詐欺' },
  { key: 'other', label: 'その他' },
];

export function ReportSheet({
  visible,
  postId,
  onClose,
}: {
  visible: boolean;
  postId: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const { report, isPending } = useReport();

  const pick = (reason: string) => {
    if (!postId || isPending) return;
    // fire-and-forget — 成否トーストは useReport 側で出す。
    void report({ postId, reason }).catch(() => {});
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
      >
        {/* カード本体 — タップを captures して backdrop close を防ぐ */}
        <SheetSwipeDown onClose={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: C.bg,
            borderTopLeftRadius: R.lg,
            borderTopRightRadius: R.lg,
            paddingTop: SP['3'],
            paddingBottom: insets.bottom + SP['4'],
            paddingHorizontal: SP['4'],
          }}
        >
          {/* grabber */}
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: C.border,
              marginBottom: SP['3'],
            }}
          />
          <Text style={[T.h4, { color: C.text, marginBottom: 2 }]}>この投稿を通報</Text>
          <Text style={[T.caption, { color: C.text3, marginBottom: SP['2'] }]}>
            運営に報告されます。当てはまる理由を選んでください。
          </Text>

          {REASONS.map((r) => (
            <PressableScale
              key={r.key}
              onPress={() => pick(r.key)}
              haptic="tap"
              accessibilityRole="button"
              accessibilityLabel={`通報理由: ${r.label}`}
              style={{
                paddingVertical: SP['4'],
                borderTopWidth: 1,
                borderTopColor: C.border,
              }}
            >
              <Text style={[T.body, { color: r.key === 'other' ? C.text2 : C.text }]}>
                {r.label}
              </Text>
            </PressableScale>
          ))}

          <PressableScale
            onPress={onClose}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel="通報をキャンセル"
            style={{
              marginTop: SP['4'],
              paddingVertical: SP['3'],
              alignItems: 'center',
              borderRadius: R.md,
              backgroundColor: C.bg2,
            }}
          >
            <Text style={[T.bodyB, { color: C.text2 }]}>キャンセル</Text>
          </PressableScale>
        </Pressable>
        </SheetSwipeDown>
      </Pressable>
    </Modal>
  );
}
