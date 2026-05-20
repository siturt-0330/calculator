import { useState } from 'react';
import { View, Text, TextInput, Platform } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

export function AddTagInline({ onSubmit }: { onSubmit: (tag: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const Plus = Icon.plus;
  const Send = Icon.send;
  const Close = Icon.close;

  const submit = async () => {
    const t = value.trim().replace(/^#/, '');
    if (!t) return;
    setBusy(true);
    try {
      await onSubmit(t);
      setValue('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <PressableScale
        onPress={() => setOpen(true)}
        haptic="tap"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['1'],
          paddingHorizontal: SP['3'],
          paddingVertical: SP['1'],
          borderRadius: R.full,
          borderWidth: 1,
          borderStyle: Platform.OS === 'web' ? 'dashed' : 'solid',
          borderColor: C.border2,
          backgroundColor: 'transparent',
        }}
      >
        <Plus size={12} color={C.text3} strokeWidth={2.4} />
        <Text style={[T.small, { color: C.text3 }]}>タグを追加</Text>
      </PressableScale>
    );
  }

  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP['2'],
      backgroundColor: C.bg3,
      borderRadius: R.full,
      borderWidth: 1,
      borderColor: C.border2,
      paddingHorizontal: SP['3'],
      paddingVertical: 2,
      minWidth: 160,
    }}>
      <Text style={[T.small, { color: C.text3 }]}>#</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="例: ネタバレ"
        placeholderTextColor={C.text4}
        style={[T.small, { color: C.text, flex: 1, paddingVertical: 4, minWidth: 80 }]}
        autoFocus
        maxLength={30}
        editable={!busy}
        onSubmitEditing={submit}
      />
      <PressableScale onPress={submit} haptic="confirm" disabled={busy || !value.trim()}>
        <Send size={14} color={value.trim() ? C.accent : C.text4} strokeWidth={2.4} />
      </PressableScale>
      <PressableScale onPress={() => { setOpen(false); setValue(''); }} haptic="tap">
        <Close size={14} color={C.text3} strokeWidth={2.4} />
      </PressableScale>
    </View>
  );
}
