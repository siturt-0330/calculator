import { useState } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useBBSThread } from '@/hooks/useBBSThread';
import { C, SP, R } from '@/design/tokens';
import { T } from '@/design/typography';
import { PressableScale } from '@/components/ui/PressableScale';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils/date';
import { randomAvatarColor } from '@/lib/utils/color';
import type { BBSReply } from '@/types/models';
import { Icon } from '@/constants/icons';
import * as Haptics from 'expo-haptics';

export default function BBSThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const SendIcon = Icon.send;
  const BackIcon = Icon.arrowL;

  const { replies, loading, reply } = useBBSThread(id);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await reply(text.trim());
      setText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </View>
    );
  }

  const renderReply = ({ item, index }: { item: BBSReply; index: number }) => (
    <View style={{ flexDirection: 'row', gap: SP['3'], paddingHorizontal: SP['4'], paddingVertical: SP['3'] }}>
      <View>
        <Avatar size={32} color={randomAvatarColor(item.id)} />
        <Text style={[T.caption, { color: C.text3, textAlign: 'center', marginTop: 2 }]}>
          {index + 1}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[T.small, { color: C.text2, marginBottom: SP['1'] }]}>{formatRelative(item.created_at)}</Text>
        <Text style={[T.body, { color: C.text }]}>{item.content}</Text>
      </View>
    </View>
  );

  const ListHeader = () => (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP['4'], paddingTop: insets.top + SP['2'], paddingBottom: SP['3'] }}>
        <PressableScale onPress={() => router.back()} haptic="tap" style={{ padding: SP['2'] }}>
          <BackIcon size={24} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <Text style={[T.h4, { color: C.text, marginLeft: SP['3'] }]}>掲示板</Text>
      </View>
      <View style={{ height: 1, backgroundColor: C.border }} />
      {replies.length > 0 && (
        <Text style={[T.smallM, { color: C.text2, paddingHorizontal: SP['4'], paddingVertical: SP['3'] }]}>
          {replies.length}件の返信
        </Text>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FlashList
        data={replies}
        keyExtractor={(item) => item.id}
        renderItem={renderReply}
        estimatedItemSize={80}
        ListHeaderComponent={<ListHeader />}
        ListEmptyComponent={
          <View style={{ padding: SP['6'], alignItems: 'center' }}>
            <Text style={[T.small, { color: C.text3 }]}>返信はまだありません</Text>
          </View>
        }
      />
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: C.border,
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
          paddingBottom: insets.bottom + SP['3'],
          backgroundColor: C.bg2,
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: SP['3'],
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="返信を入力..."
          placeholderTextColor={C.text3}
          multiline
          maxLength={500}
          style={[
            T.body,
            {
              flex: 1,
              color: C.text,
              backgroundColor: C.bg3,
              borderRadius: R.lg,
              paddingHorizontal: SP['4'],
              paddingVertical: SP['3'],
              maxHeight: 100,
            },
          ]}
        />
        <PressableScale
          onPress={handleSend}
          disabled={!text.trim() || sending}
          haptic="confirm"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: text.trim() ? C.accent : C.bg4,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <SendIcon size={18} color="#fff" strokeWidth={2.2} />
          )}
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}
