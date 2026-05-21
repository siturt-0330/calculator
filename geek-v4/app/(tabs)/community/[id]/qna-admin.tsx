// ============================================================
// Q&A ナレッジ管理 (管理者のみ)
// ============================================================
// 公式管理者だけがアクセス可能。ナレッジドキュメントの一覧 / 追加 / 削除。
// ============================================================
import { View, Text, ScrollView, Modal, TextInput, ActivityIndicator, Platform } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { BackButton } from '../../../../components/nav/BackButton';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Spinner } from '../../../../components/ui/Spinner';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { Icon } from '../../../../constants/icons';
import { useToastStore } from '../../../../stores/toastStore';
import { useAuthStore } from '../../../../stores/authStore';
import { fetchCommunity } from '../../../../lib/api/communities';
import {
  fetchQnaDocuments,
  createQnaDocument,
  deleteQnaDocument,
  type QnaDocument,
} from '../../../../lib/api/officialCommunities';
import { formatRelative } from '../../../../lib/utils/date';
import { TABBAR } from '../../../../design/tabbar';

export default function QnaAdminScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const userId = useAuthStore((s) => s.user?.id);
  const { show } = useToastStore();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pendingDelete, setPendingDelete] = useState<QnaDocument | null>(null);

  const { data: community } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });
  const isAdmin = !!community && !!userId && community.official_admin_user_id === userId;

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['community', id, 'qna-docs'],
    queryFn: () => fetchQnaDocuments(id),
    enabled: id.length > 0 && isAdmin,
    staleTime: 20_000,
  });

  const create = useMutation({
    mutationFn: () => createQnaDocument({ communityId: id, title: title.trim(), content: content.trim() }),
    onSuccess: () => {
      show('ナレッジを追加しました', 'success');
      setModalOpen(false);
      setTitle('');
      setContent('');
      void qc.invalidateQueries({ queryKey: ['community', id, 'qna-docs'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '追加に失敗しました';
      show(msg, 'error');
    },
  });

  const remove = useMutation({
    mutationFn: (docId: string) => deleteQnaDocument(docId),
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['community', id, 'qna-docs'] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <BackButton />
        <EmptyState
          icon={Icon.lock}
          title="権限がありません"
          message="このコミュニティの管理者だけがナレッジを編集できます"
        />
      </View>
    );
  }

  const canSubmit = title.trim().length >= 1 && content.trim().length >= 1 && content.length <= 50000 && !create.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>ナレッジ管理</Text>
        <PressableScale
          onPress={() => setModalOpen(true)}
          haptic="confirm"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
            backgroundColor: C.accent,
            borderRadius: R.full,
          }}
        >
          <Icon.plus size={14} color="#fff" strokeWidth={2.6} />
          <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>追加</Text>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['16'],
          gap: SP['3'],
        }}
      >
        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={Icon.info}
            title="まだナレッジがありません"
            message="このコミュニティで質問された時に参照されるドキュメントを追加しましょう"
            actionLabel="+ ナレッジを追加"
            onAction={() => setModalOpen(true)}
            tone="accent"
          />
        ) : (
          docs.map((d, i) => (
            <Animated.View key={d.id} entering={FadeInDown.delay(i * 30).duration(220)}>
              <View
                style={[{
                  padding: SP['3'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  gap: SP['2'],
                }, SHADOW.card]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                  <Text style={[T.bodyB, { color: C.text, flex: 1 }]} numberOfLines={2}>{d.title}</Text>
                  <PressableScale
                    onPress={() => setPendingDelete(d)}
                    haptic="warn"
                    style={{ padding: 6 }}
                    accessibilityLabel="削除"
                  >
                    <Icon.trash size={16} color={C.red} strokeWidth={2.2} />
                  </PressableScale>
                </View>
                <Text style={[T.small, { color: C.text2 }]} numberOfLines={4}>{d.content}</Text>
                <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(d.created_at)}</Text>
              </View>
            </Animated.View>
          ))
        )}
      </ScrollView>

      {/* 追加モーダル */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R['2xl'],
              borderTopRightRadius: R['2xl'],
              padding: SP['4'],
              paddingBottom: insets.bottom + SP['4'],
              gap: SP['3'],
              maxHeight: '90%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.h3, { color: C.text, flex: 1 }]}>ナレッジを追加</Text>
              <PressableScale onPress={() => setModalOpen(false)} haptic="tap" style={{ padding: 6 }}>
                <Icon.close size={20} color={C.text2} strokeWidth={2.4} />
              </PressableScale>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: SP['3'] }}>
              <View style={{ gap: 4 }}>
                <Text style={[T.small, { color: C.text2 }]}>タイトル</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="例: 開催スケジュールについて"
                  placeholderTextColor={C.text3}
                  style={[
                    T.body,
                    {
                      color: C.text,
                      backgroundColor: C.bg3,
                      borderRadius: R.md,
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['3'],
                    },
                  ]}
                  maxLength={200}
                />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={[T.small, { color: C.text2 }]}>本文 (最大 50,000 文字)</Text>
                <TextInput
                  value={content}
                  onChangeText={setContent}
                  placeholder="このコミュニティに関する情報・FAQ・スケジュールなど"
                  placeholderTextColor={C.text3}
                  multiline
                  style={[
                    T.body,
                    {
                      color: C.text,
                      backgroundColor: C.bg3,
                      borderRadius: R.md,
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['3'],
                      minHeight: Platform.OS === 'web' ? 200 : 160,
                      textAlignVertical: 'top',
                    },
                  ]}
                  maxLength={50000}
                />
                <Text style={[T.caption, { color: C.text3, textAlign: 'right' }]}>
                  {content.length.toLocaleString('ja-JP')} / 50,000
                </Text>
              </View>
            </ScrollView>

            <PressableScale
              onPress={() => create.mutate()}
              haptic="confirm"
              disabled={!canSubmit}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: SP['3'],
                backgroundColor: C.accent,
                borderRadius: R.lg,
                opacity: canSubmit ? 1 : 0.5,
              }}
            >
              {create.isPending && <ActivityIndicator size="small" color="#fff" />}
              <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>追加する</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="ナレッジを削除"
        message={pendingDelete ? `「${pendingDelete.title}」を削除します。回答の参照元から消えます。` : ''}
        confirmLabel="削除する"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        destructive
      />

    </View>
  );
}
