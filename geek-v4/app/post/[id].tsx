import { useState } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { fetchPostById } from '@/lib/api/posts';
import { fetchReplies, createReply } from '@/lib/api/bbs';
import { C, SP, R } from '@/design/tokens';
import { T } from '@/design/typography';
import { PressableScale } from '@/components/ui/PressableScale';
import { Avatar } from '@/components/ui/Avatar';
import { TagPill } from '@/components/tag/TagPill';
import { Spinner } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils/date';
import { randomAvatarColor } from '@/lib/utils/color';
import type { BBSReply } from '@/types/models';
import { Icon } from '@/constants/icons';
import * as Haptics from 'expo-haptics';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const SendIcon = Icon.send;
  const BackIcon = Icon.arrowL;

  const { data: post, isLoading: postLoading, isError: postError } = useQuery({
    queryKey: ['post', id],
    queryFn: () => fetchPostById(id),
    enabled: !!id,
  });

  const { data: replies = [], isLoading: repliesLoading, refetch, isRefetching } = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => fetchReplies(id),
    enabled: !!id,
  });

  const { mutateAsync: submitReply, isPending } = useMutation({
    mutationFn: (content: string) => createReply(id, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-comments', id] });
      setText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const handleSend = async () => {
    if (!text.trim() || isPending) return;
    await submitReply(text.trim());
  };

  if (postLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </View>
    );
  }

  if (postError || !post) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: SP['6'] }}>
        <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>投稿を取得できませんでした</Text>
        <PressableScale onPress={() => router.back()} haptic="tap" style={{ marginTop: SP['4'] }}>
          <Text style={[T.small, { color: C.accent }]}>戻る</Text>
        </PressableScale>
      </View>
    );
  }

  const renderReply = ({ item, index }: { item: BBSReply; index: number }) => (
    <View style={{ flexDirection: 'row', gap: SP['3'], paddingHorizontal: SP['4'], paddingVertical: SP['3'] }}>
      <Avatar size={32} color={randomAvatarColor(item.id)} name={String(index + 1)} />
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
        <Text style={[T.h4, { color: C.text, marginLeft: SP['3'] }]}>投稿</Text>
      </View>
      <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['4'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'], marginBottom: SP['3'] }}>
          <Avatar size={40} anonymous />
          <Text style={[T.small, { color: C.text3 }]}>{formatRelative(post.created_at)}</Text>
        </View>
        <Text style={[T.body, { color: C.text, lineHeight: 24, marginBottom: SP['3'] }]}>{post.content}</Text>
        {post.tag_names.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {post.tag_names.map((tag) => (
              <TagPill key={tag} name={tag} state="normal" />
            ))}
          </View>
        )}
      </View>
      <View style={{ height: 1, backgroundColor: C.border, marginBottom: SP['2'] }} />
      {replies.length > 0 && (
        <Text style={[T.smallM, { color: C.text2, paddingHorizontal: SP['4'], paddingBottom: SP['2'] }]}>
          {replies.length}件のコメント
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
        estimatedItemSize={72}
        ListHeaderComponent={<ListHeader />}
        ListEmptyComponent={
          repliesLoading ? (
            <View style={{ padding: SP['6'], alignItems: 'center' }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : (
            <View style={{ padding: SP['6'], alignItems: 'center' }}>
              <Text style={[T.small, { color: C.text3 }]}>コメントはまだありません</Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.accent} />
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
          placeholder="コメントを入力..."
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
          disabled={!text.trim() || isPending}
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
          {isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <SendIcon size={18} color="#fff" strokeWidth={2.2} />
          )}
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}
