// ============================================================
// QnaTabInline — 公式コミュニティの Q&A タブ (NotebookLM 風)
// ============================================================
// 管理者が登録したナレッジから検索して回答する。
// 一般ユーザー: 質問入力 + 履歴閲覧
// 管理者: 加えて「ナレッジを管理」ボタンが出る
// ============================================================
import { useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import {
  askQna,
  fetchQnaHistory,
  fetchQnaDocuments,
  type QnaQuestion,
} from '../../lib/api/officialCommunities';
import type { CommunityWithMembership } from '../../lib/api/communities';

export function QnaTabInline({
  communityId,
  community,
}: {
  communityId: string;
  community: CommunityWithMembership;
}) {
  const userId = useAuthStore((s) => s.user?.id);
  const { show } = useToastStore();
  const qc = useQueryClient();
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [latest, setLatest] = useState<QnaQuestion | null>(null);

  const isAdmin = !!userId && community.official_admin_user_id === userId;

  const { data: history = [] } = useQuery({
    queryKey: ['community', communityId, 'qna-history'],
    queryFn: () => fetchQnaHistory(communityId, 30),
    enabled: communityId.length > 0,
    staleTime: 15_000,
  });

  const { data: docs = [] } = useQuery({
    queryKey: ['community', communityId, 'qna-docs'],
    queryFn: () => fetchQnaDocuments(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });
  const docTitleById = new Map<string, string>(docs.map((d) => [d.id, d.title]));

  const ask = useMutation({
    mutationFn: () => askQna({ communityId, question: question.trim() }),
    onSuccess: (q) => {
      setLatest(q);
      setQuestion('');
      void qc.invalidateQueries({ queryKey: ['community', communityId, 'qna-history'] });
    },
    onError: (e: unknown) => {
      show(e instanceof Error ? e.message : '質問の送信に失敗しました', 'error');
    },
  });

  const canAsk = question.trim().length >= 3 && !ask.isPending;

  return (
    <View style={{ padding: SP['4'], gap: SP['4'] }}>
      {/* 入力 */}
      <View style={{ gap: SP['2'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon.help size={16} color={C.accent} strokeWidth={2.4} />
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
            このコミュニティに質問する
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            gap: SP['2'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'],
            alignItems: 'flex-end',
          }}
        >
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="例: 使い方を教えて"
            placeholderTextColor={C.text3}
            multiline
            style={{
              flex: 1,
              color: C.text,
              fontSize: 14,
              maxHeight: 100,
              paddingVertical: 4,
            }}
          />
          <PressableScale
            onPress={() => canAsk && ask.mutate()}
            disabled={!canAsk}
            haptic="confirm"
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'],
              backgroundColor: canAsk ? C.accent : C.bg3,
              borderRadius: R.full,
              opacity: canAsk ? 1 : 0.5,
              minWidth: 60,
              alignItems: 'center',
            }}
          >
            {ask.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>送信</Text>
            )}
          </PressableScale>
        </View>
        {isAdmin && (
          <PressableScale
            onPress={() => router.push(`/community/${communityId}/qna-admin` as never)}
            haptic="tap"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-start',
              paddingHorizontal: SP['3'],
              paddingVertical: 6,
              backgroundColor: C.bg2,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Icon.plus size={12} color={C.text2} strokeWidth={2.4} />
            <Text style={[T.caption, { color: C.text2, fontWeight: '600' }]}>
              ナレッジを管理 ({docs.length})
            </Text>
          </PressableScale>
        )}
      </View>

      {/* 最新の回答 */}
      {latest && (
        <View
          style={{
            padding: SP['3'],
            backgroundColor: C.accentBg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.accent + '40',
            gap: SP['2'],
          }}
        >
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
            Q. {latest.question}
          </Text>
          <Text style={[T.body, { color: C.text }]}>
            {latest.answer || '...'}
          </Text>
          {latest.source_doc_ids.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {latest.source_doc_ids.map((sid) => (
                <View
                  key={sid}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    backgroundColor: C.bg2,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Icon.info size={10} color={C.text3} strokeWidth={2.4} />
                  <Text style={[T.caption, { color: C.text2, fontWeight: '600' }]} numberOfLines={1}>
                    {docTitleById.get(sid) ?? 'ナレッジ'}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* 履歴 */}
      <View style={{ gap: SP['2'] }}>
        <Text style={[T.smallM, { color: C.text3, fontWeight: '700' }]}>
          みんなの質問
        </Text>
        {history.length === 0 ? (
          <View
            style={{
              padding: SP['4'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon.help size={28} color={C.text3} strokeWidth={1.8} />
            <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
              まだ質問がありません。{'\n'}最初の質問をしてみましょう。
            </Text>
          </View>
        ) : (
          history.map((h) => (
            <View
              key={h.id}
              style={{
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                gap: 6,
              }}
            >
              <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
                Q. {h.question}
              </Text>
              {h.answer && (
                <Text style={[T.small, { color: C.text2 }]} numberOfLines={3}>
                  {h.answer}
                </Text>
              )}
              <Text style={[T.caption, { color: C.text3 }]}>
                {formatRelative(h.asked_at)}
                {h.status === 'no_source' && ' · 該当ナレッジなし'}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
