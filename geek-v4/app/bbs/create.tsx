import { useState } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createThread } from '@/lib/api/bbs';
import { C, SP, R } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { Icon } from '@/constants/icons';
import * as Haptics from 'expo-haptics';

export default function BBSCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const BackIcon = Icon.arrowL;

  const { mutateAsync, isPending } = useMutation({
    mutationFn: () => createThread(title.trim(), category.trim() || '雑談'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bbs-threads'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('スレッドの作成に失敗しました。');
    },
  });

  const handleSubmit = async () => {
    setError('');
    if (!title.trim()) {
      setError('タイトルを入力してください。');
      return;
    }
    if (title.trim().length > 50) {
      setError('タイトルは50文字以内で入力してください。');
      return;
    }
    await mutateAsync();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['3'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <PressableScale onPress={() => router.back()} haptic="tap" style={{ padding: SP['2'] }}>
          <BackIcon size={24} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <Text style={[T.h4, { color: C.text, flex: 1, marginLeft: SP['3'] }]}>スレッドを作成</Text>
        <Button
          label="投稿"
          onPress={handleSubmit}
          loading={isPending}
          disabled={!title.trim()}
          size="sm"
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP['5'], gap: SP['5'] }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[T.small, { color: C.text2 }]}>タイトル</Text>
            <Text style={[T.small, { color: title.length > 50 ? C.red : C.text3 }]}>
              {title.length} / 50
            </Text>
          </View>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="スレッドのタイトルを入力..."
            placeholderTextColor={C.text3}
            maxLength={60}
            autoFocus
            style={[
              T.body,
              {
                color: C.text,
                backgroundColor: C.bg3,
                borderRadius: R.md,
                paddingHorizontal: SP['4'],
                paddingVertical: SP['3'],
                borderWidth: 1.5,
                borderColor: C.border,
              },
            ]}
          />
        </View>

        <View style={{ gap: SP['2'] }}>
          <Text style={[T.small, { color: C.text2 }]}>カテゴリ（任意）</Text>
          <TextInput
            value={category}
            onChangeText={setCategory}
            placeholder="例: アニメ、ゲーム、雑談..."
            placeholderTextColor={C.text3}
            style={[
              T.body,
              {
                color: C.text,
                backgroundColor: C.bg3,
                borderRadius: R.md,
                paddingHorizontal: SP['4'],
                paddingVertical: SP['3'],
                borderWidth: 1.5,
                borderColor: C.border,
              },
            ]}
          />
        </View>

        {error ? (
          <View style={{ backgroundColor: C.redBg, borderRadius: R.md, padding: SP['3'] }}>
            <Text style={[T.small, { color: C.red }]}>{error}</Text>
          </View>
        ) : null}

        <View style={{ backgroundColor: C.bg3, borderRadius: R.md, padding: SP['4'], gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>投稿のヒント</Text>
          <Text style={[T.small, { color: C.text3 }]}>・議論したいテーマを具体的に書くと参加者が増えます</Text>
          <Text style={[T.small, { color: C.text3 }]}>・全ての投稿は匿名で表示されます</Text>
          <Text style={[T.small, { color: C.text3 }]}>・個人情報は書き込まないでください</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
