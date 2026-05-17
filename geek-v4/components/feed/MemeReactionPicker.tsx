import { Modal, View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/ui/PressableScale';
import { Icon } from '@/constants/icons';
import { MEMES } from '@/lib/memes';
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
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View style={{
          maxHeight: '75%',
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
              ミームでリアクション
            </Text>
            <PressableScale onPress={onClose} style={{ padding: SP['2'] }} haptic="tap">
              <Icon.close size={22} color={C.text2} strokeWidth={2.2} />
            </PressableScale>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            タップして送信。もう一度タップで取り消し。
          </Text>
          <ScrollView contentContainerStyle={{ gap: SP['4'] }}>
            {MEMES.map((cat) => (
              <View key={cat.category} style={{ gap: SP['2'] }}>
                <Text style={[T.smallM, { color: C.text3 }]}>{cat.category}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {cat.items.map((m) => {
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
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
