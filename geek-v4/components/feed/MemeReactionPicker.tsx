import { useState, useMemo, useEffect } from 'react';
import { Modal, View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { MEMES } from '../../lib/memes';
import { useUserStamps, useCreateUserStamp } from '../../hooks/useUserStamps';
import { useToastStore } from '../../stores/toastStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export function MemeReactionPicker({
  visible,
  onClose,
  onPick,
  picked,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (meme: string) => void;
  // 親から渡される「サーバー側で確定済み」のスタンプ一覧
  picked: string[];
}) {
  const insets = useSafeAreaInsets();
  const [customText, setCustomText] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const { stamps: userStamps } = useUserStamps();
  const { mutateAsync: createStamp, isPending: creating } = useCreateUserStamp();
  // toast actions のみ subscribe — picker は post カードから render される多発路
  const show = useToastStore((s) => s.show);
  // ローカル送信ロック: ネット往復中に再タップを即座に弾く (React Query の
  // isPending 反映遅延 / state 反映前の二重押下を防ぐ defense-in-depth)
  const [submitting, setSubmitting] = useState(false);

  // ★ ローカル「直近で押したスタンプ」を保持。サーバー反映が遅くても
  // すぐにチップが選択状態に見えるようにする (Realtime invalidate 中に
  // 選択状態が一瞬消える "勝手に消える" 現象の対策)。
  const [recentLocalPicks, setRecentLocalPicks] = useState<Set<string>>(new Set());

  // モーダルを開き直すたびに local state をリセット
  useEffect(() => {
    if (visible) setRecentLocalPicks(new Set());
  }, [visible]);

  // 公開ユーザースタンプを use_count 降順で取得 → "みんなの" カテゴリ
  const popularUserStamps = useMemo(
    () => userStamps.filter((s) => s.is_public).slice(0, 30).map((s) => s.text),
    [userStamps],
  );

  // 表示用の選択状態 = サーバー確定済み ∪ 直近ローカルタップ
  const visiblyPicked = useMemo(
    () => new Set<string>([...picked, ...recentLocalPicks]),
    [picked, recentLocalPicks],
  );

  const handlePick = (meme: string) => {
    // ローカル選択をすぐ反映 (toggle 動作)
    setRecentLocalPicks((prev) => {
      const next = new Set(prev);
      if (next.has(meme)) next.delete(meme);
      else next.add(meme);
      return next;
    });
    // サーバーへ送信は親に委譲 (optimistic update + realtime)
    onPick(meme);
  };

  const handleCreate = async () => {
    if (submitting) return;
    const t = customText.trim();
    if (!t) return;
    setSubmitting(true);
    try {
      const stamp = await createStamp({ text: t, isPublic: true });
      show(`「${t}」を作成しました`, 'success');
      setCustomText('');
      setShowCustomInput(false);
      // 作成と同時に送信もする
      if (stamp) {
        setRecentLocalPicks((prev) => new Set(prev).add(stamp.text));
        onPick(stamp.text);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'スタンプの作成に失敗しました';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View style={{
          maxHeight: '85%',
          backgroundColor: C.bg2,
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['4'],
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTopWidth: 1,
          borderColor: C.border,
          gap: SP['3'],
        }}>
          {/* ヘッダー: 左 ×  / 中央 タイトル / 右 完了 */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <PressableScale
              onPress={onClose}
              style={{
                padding: SP['2'],
                marginLeft: -SP['2'],
              }}
              haptic="tap"
            >
              <Icon.close size={24} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
            <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18 }}>🪶</Text>
              <Text style={[T.h4, { color: C.text, marginLeft: SP['1'] }]}>
                テキストスタンプ
              </Text>
            </View>
            <PressableScale
              onPress={onClose}
              haptic="confirm"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: SP['1'],
                marginRight: -SP['2'],
              }}
            >
              <Text style={[T.bodyM, { color: C.accent, fontWeight: '700' }]}>完了</Text>
            </PressableScale>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            タップして送信。何個でも押せます。完了で閉じる。
          </Text>

          {/* カスタム作成エリア */}
          {showCustomInput ? (
            <View style={{
              gap: SP['2'],
              padding: SP['3'],
              backgroundColor: C.bg3,
              borderRadius: R.lg,
              borderWidth: 1, borderColor: C.accent,
            }}>
              <Text style={[T.smallM, { color: C.accent }]}>あたらしいスタンプを作る</Text>
              <TextInput
                value={customText}
                onChangeText={setCustomText}
                placeholder="例: それは芸術点高い"
                placeholderTextColor={C.text3}
                maxLength={40}
                autoFocus
                keyboardAppearance="dark"
                style={{
                  color: C.text,
                  fontSize: 14,
                  fontFamily: 'NotoSansJP_400Regular',
                  backgroundColor: C.bg,
                  borderRadius: R.md,
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['2'],
                  borderWidth: 1, borderColor: C.border,
                }}
                onSubmitEditing={handleCreate}
                returnKeyType="send"
              />
              <Text style={{ fontSize: 10, color: C.text3, textAlign: 'right' }}>
                {customText.length} / 40
              </Text>
              <View style={{ flexDirection: 'row', gap: SP['2'] }}>
                <PressableScale
                  onPress={() => { setShowCustomInput(false); setCustomText(''); }}
                  haptic="tap"
                  style={{
                    flex: 1, paddingVertical: SP['2'],
                    backgroundColor: C.bg, borderRadius: R.md,
                    borderWidth: 1, borderColor: C.border,
                    alignItems: 'center',
                  }}
                >
                  <Text style={[T.smallM, { color: C.text2 }]}>キャンセル</Text>
                </PressableScale>
                <PressableScale
                  onPress={handleCreate}
                  disabled={!customText.trim() || creating || submitting}
                  haptic="confirm"
                  style={{
                    flex: 2, paddingVertical: SP['2'],
                    backgroundColor: customText.trim() && !creating && !submitting ? C.accent : C.bg4,
                    borderRadius: R.md,
                    alignItems: 'center',
                  }}
                >
                  {creating || submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>作って送る</Text>
                  )}
                </PressableScale>
              </View>
            </View>
          ) : (
            <PressableScale
              onPress={() => setShowCustomInput(true)}
              haptic="tap"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SP['2'],
                paddingHorizontal: SP['3'], paddingVertical: SP['3'],
                backgroundColor: C.bg3,
                borderRadius: R.lg,
                borderWidth: 1, borderColor: C.border,
                borderStyle: 'dashed',
              }}
            >
              <Icon.plus size={16} color={C.accent} strokeWidth={2.4} />
              <Text style={[T.smallM, { color: C.accent }]}>
                自分のスタンプを作る (40文字まで・全員と共有)
              </Text>
            </PressableScale>
          )}

          <ScrollView contentContainerStyle={{ gap: SP['4'], paddingBottom: SP['4'] }}>
            {/* みんなが作ったスタンプ (上位) */}
            {popularUserStamps.length > 0 && (
              <CategoryRow
                title="✨ みんなが作った人気のスタンプ"
                items={popularUserStamps}
                picked={visiblyPicked}
                onPick={handlePick}
              />
            )}
            {/* 定型スタンプ */}
            {MEMES.map((cat) => (
              <CategoryRow
                key={cat.category}
                title={cat.category}
                items={cat.items}
                picked={visiblyPicked}
                onPick={handlePick}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CategoryRow({
  title, items, picked, onPick,
}: {
  title: string;
  items: string[];
  picked: Set<string>;
  onPick: (m: string) => void;
}) {
  return (
    <View style={{ gap: SP['2'] }}>
      <Text style={[T.smallM, { color: C.text3 }]}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {items.map((m) => {
          const isPicked = picked.has(m);
          return (
            <PressableScale
              key={m}
              onPress={() => onPick(m)}
              haptic="select"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 8,
                backgroundColor: isPicked ? C.accent : C.bg3,
                borderRadius: R.full,
                borderWidth: 1.5,
                borderColor: isPicked ? C.accent : C.border,
              }}
            >
              <Text style={{
                fontSize: 13,
                color: isPicked ? '#fff' : C.text,
                fontWeight: '700',
              }}>
                {isPicked ? '✓ ' : ''}{m}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}
