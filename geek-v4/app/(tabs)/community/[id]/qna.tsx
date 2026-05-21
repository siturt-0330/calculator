// ============================================================
// 公式 Q&A コーナー (NotebookLM 風)
// ============================================================
// メンバー: 質問入力欄 → 回答 (ソース付き) + 履歴
// 管理者: 「ナレッジ追加」CTA で qna-admin へ遷移
// ============================================================
import { View, Text, ScrollView, TextInput, ActivityIndicator, Pressable } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { BackButton } from '../../../../components/nav/BackButton';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Spinner } from '../../../../components/ui/Spinner';
import { Icon } from '../../../../constants/icons';
import { OfficialBadge } from '../../../../components/community/OfficialBadge';
import { useToastStore } from '../../../../stores/toastStore';
import { useAuthStore } from '../../../../stores/authStore';
import { fetchCommunity } from '../../../../lib/api/communities';
import {
  askQna,
  fetchQnaDocuments,
  fetchQnaHistory,
  type QnaQuestion,
} from '../../../../lib/api/officialCommunities';
import { formatRelative } from '../../../../lib/utils/date';
import { TABBAR } from '../../../../design/tabbar';

export default function QnaScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const userId = useAuthStore((s) => s.user?.id);
  const { show } = useToastStore();
  const qc = useQueryClient();

  const [question, setQuestion] = useState('');
  const [latest, setLatest] = useState<QnaQuestion | null>(null);

  const { data: community } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });

  const isAdmin = !!community && !!userId && community.official_admin_user_id === userId;

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['community', id, 'qna-history'],
    queryFn: () => fetchQnaHistory(id, 30),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  // 全 doc を引いて、回答に source_doc_ids が含まれていれば title を表示する
  const { data: docs = [] } = useQuery({
    queryKey: ['community', id, 'qna-docs'],
    queryFn: () => fetchQnaDocuments(id),
    enabled: id.length > 0,
    staleTime: 30_000,
  });
  const docTitleById = new Map<string, string>(docs.map((d) => [d.id, d.title]));

  const ask = useMutation({
    mutationFn: () => askQna({ communityId: id, question: question.trim() }),
    onSuccess: (q) => {
      setLatest(q);
      setQuestion('');
      void qc.invalidateQueries({ queryKey: ['community', id, 'qna-history'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '質問の送信に失敗しました';
      show(msg, 'error');
    },
  });

  const handleAsk = () => {
    if (question.trim().length < 2 || ask.isPending) return;
    ask.mutate();
  };

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
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[T.h3, { color: C.text }]}>Q&A</Text>
          {community?.is_official && <OfficialBadge size="sm" />}
        </View>
        {isAdmin && (
          <PressableScale
            onPress={() => router.push(`/community/${id}/qna-admin` as never)}
            haptic="tap"
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
            <Icon.settings size={12} color="#fff" strokeWidth={2.4} />
            <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>ナレッジ管理</Text>
          </PressableScale>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['4'],
          paddingBottom: TABBAR.height + insets.bottom + SP['16'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 質問入力 */}
        <Animated.View entering={FadeInDown.duration(220)}>
          <View
            style={[{
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              padding: SP['3'],
              gap: SP['2'],
            }, SHADOW.card]}
          >
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>質問する</Text>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="例: 開催日はいつですか?"
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
                  minHeight: 60,
                  textAlignVertical: 'top',
                },
              ]}
              maxLength={500}
            />
            <PressableScale
              onPress={handleAsk}
              haptic="confirm"
              disabled={question.trim().length < 2 || ask.isPending}
              style={{
                alignSelf: 'flex-end',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: SP['4'],
                paddingVertical: 8,
                backgroundColor: C.accent,
                borderRadius: R.full,
                opacity: question.trim().length < 2 || ask.isPending ? 0.5 : 1,
              }}
            >
              {ask.isPending && <ActivityIndicator size="small" color="#fff" />}
              <Icon.send size={14} color="#fff" strokeWidth={2.4} />
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>送信</Text>
            </PressableScale>
          </View>
        </Animated.View>

        {/* 最新回答 */}
        {latest && (
          <Animated.View entering={FadeIn.duration(220)}>
            <AnswerCard
              q={latest}
              docTitleById={docTitleById}
              isAdmin={isAdmin}
              onRequestKnowledge={() => router.push(`/community/${id}/qna-admin` as never)}
            />
          </Animated.View>
        )}

        {/* 履歴 */}
        <View style={{ gap: SP['2'], marginTop: SP['2'] }}>
          <Text style={[T.smallB, { color: C.text3, letterSpacing: 1, textTransform: 'uppercase' }]}>
            Q&A 履歴
          </Text>
          {historyLoading ? (
            <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}>
              <Spinner />
            </View>
          ) : history.length === 0 ? (
            <EmptyState
              icon={Icon.help}
              title="まだ質問がありません"
              message="気になることを質問してみよう"
              tone="accent"
            />
          ) : (
            history
              .filter((q) => q.id !== latest?.id)
              .map((q) => (
                <AnswerCard
                  key={q.id}
                  q={q}
                  docTitleById={docTitleById}
                  isAdmin={isAdmin}
                  onRequestKnowledge={() => router.push(`/community/${id}/qna-admin` as never)}
                />
              ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function AnswerCard({
  q,
  docTitleById,
  isAdmin,
  onRequestKnowledge,
}: {
  q: QnaQuestion;
  docTitleById: Map<string, string>;
  isAdmin: boolean;
  onRequestKnowledge: () => void;
}) {
  const noSource = q.status === 'no_source';
  return (
    <View
      style={[{
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: noSource ? C.amber + '55' : C.border,
        padding: SP['3'],
        gap: SP['2'],
      }, SHADOW.card]}
    >
      {/* 質問 */}
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <View
          style={{
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: R.sm,
            backgroundColor: C.accentBg,
          }}
        >
          <Text style={{ color: C.accentLight, fontSize: 10, fontWeight: '800' }}>Q</Text>
        </View>
        <Text style={[T.bodyB, { color: C.text, flex: 1 }]}>{q.question}</Text>
      </View>

      {/* 回答 */}
      {q.answer && (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: R.sm,
              backgroundColor: noSource ? C.amberBg : C.greenBg,
            }}
          >
            <Text style={{ color: noSource ? C.amber : C.green, fontSize: 10, fontWeight: '800' }}>A</Text>
          </View>
          <Text style={[T.body, { color: C.text2, flex: 1, lineHeight: 22 }]}>{q.answer}</Text>
        </View>
      )}

      {/* ソース */}
      {q.source_doc_ids.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          {q.source_doc_ids.map((sid) => {
            const title = docTitleById.get(sid) ?? 'ソース';
            return (
              <View
                key={sid}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: SP['2'],
                  paddingVertical: 3,
                  backgroundColor: C.bg3,
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Icon.info size={10} color={C.text3} strokeWidth={2.4} />
                <Text style={{ color: C.text2, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
                  {title}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* no_source の場合 — 管理者にナレッジ追加を依頼 */}
      {noSource && (
        <Pressable
          onPress={isAdmin ? onRequestKnowledge : undefined}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: SP['3'],
            paddingVertical: 8,
            backgroundColor: C.amberBg,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.amber + '55',
          }}
        >
          <Icon.warn size={12} color={C.amber} strokeWidth={2.4} />
          <Text style={[T.caption, { color: C.amber, fontWeight: '700', flex: 1 }]}>
            {isAdmin ? '管理者: ナレッジを追加する →' : '管理者にナレッジ追加を依頼'}
          </Text>
        </Pressable>
      )}

      <Text style={[T.caption, { color: C.text4, marginTop: 2 }]}>
        {formatRelative(q.asked_at)}
      </Text>
    </View>
  );
}

