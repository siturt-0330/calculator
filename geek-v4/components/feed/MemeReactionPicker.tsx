import { useState, useMemo } from 'react';
import { Modal, View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/ui/PressableScale';
import { Icon } from '@/constants/icons';
import { MEMES } from '@/lib/memes';
import { useUserStamps, useCreateUserStamp } from '@/hooks/useUserStamps';
import { useToastStore } from '@/stores/toastStore';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

export function MemeReactionPicker({
  visible,
  onClose,
  onPick,
  picked,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (meme: string) => void;
  picked: string[];
}) {
  const insets = useSafeAreaInsets();
  const [customText, setCustomText] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const { stamps: userStamps } = useUserStamps();
  const { mutateAsync: createStamp, isPending: creating } = useCreateUserStamp();
  const { show } = useToastStore();

  // 公開ユーザースタンプを use_count 降順で取得 → "みんなの" カテゴリ
  const popularUserStamps = useMemo(
    () => userStamps.filter((s) => s.is_public).slice(0, 30).map((s) => s.text),
    [userStamps],
  );

  const handleCreate = async () => {
    const t = customText.trim();
    if (!t) return;
    try {
      const stamp = await createStamp({ text: t, isPublic: true });
      show(`「${t}」を作成しました`, 'success');
      setCustomText('');
      setShowCustomInput(false);
      // 作成と同時に送信もする
      if (stamp) onPick(stamp.text);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'スタンプの作成に失敗しました';
      show(msg, 'error');
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
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 20 }}>🪶</Text>
            <Text style={[T.h3, { color: C.text, marginLeft: SP['2'], flex: 1 }]}>
              テキストスタンプ
            </Text>
            <PressableScale onPress={onClose} style={{ padding: SP['2'] }} haptic="tap">
              <Icon.close size={22} color={C.text2} strokeWidth={2.2} />
            </PressableScale>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            タップして送信。同じスタンプを送った人数が、投稿者に通知されます (24時間集計)。
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
                  disabled={!customText.trim() || creating}
                  haptic="confirm"
                  style={{
                    flex: 2, paddingVertical: SP['2'],
                    backgroundColor: customText.trim() && !creating ? C.accent : C.bg4,
                    borderRadius: R.md,
                    alignItems: 'center',
                  }}
                >
                  {creating ? (
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
                picked={picked}
                onPick={onPick}
              />
            )}
            {/* 定型スタンプ */}
            {MEMES.map((cat) => (
              <CategoryRow
                key={cat.category}
                title={cat.category}
                items={cat.items}
                picked={picked}
                onPick={onPick}
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
  picked: string[];
  onPick: (m: string) => void;
}) {
  return (
    <View style={{ gap: SP['2'] }}>
      <Text style={[T.smallM, { color: C.text3 }]}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {items.map((m) => {
          const isPicked = picked.includes(m);
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
