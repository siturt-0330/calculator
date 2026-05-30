import { useState } from 'react';
import { View, Text } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TagPill } from './TagPill';
import { AddTagInline } from './AddTagInline';
import { PressableScale } from '../ui/PressableScale';
import { useToastStore } from '../../stores/toastStore';
import { useTagRecommendations } from '../../hooks/useTagRecommendations';
import {
  fetchTagRelations,
  fetchGroupsForTag,
  fetchGroupMembers,
  suggestTagRelation,
} from '../../lib/api/tags';
import { fetchTagSynonyms, voteTagSynonym } from '../../lib/api/tagSynonyms';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export function TagRelations({
  tagName,
  onTagPress,
}: {
  tagName: string;
  onTagPress: (t: string) => void;
}) {
  const qc = useQueryClient();
  // toast action のみ subscribe
  const show = useToastStore((s) => s.show);
  const [mode, setMode] = useState<'alias' | 'related' | null>(null);

  const { data: relations = [] } = useQuery({
    queryKey: ['tag-relations', tagName],
    queryFn: () => fetchTagRelations(tagName),
  });
  const { data: groups = [] } = useQuery({
    queryKey: ['tag-groups', tagName],
    queryFn: () => fetchGroupsForTag(tagName),
  });
  // 全ユーザー共有の synonym 票 (mv_tag_synonyms から)
  const { data: sharedSynonyms = [] } = useQuery({
    queryKey: ['tag-shared-synonyms', tagName],
    queryFn: () => fetchTagSynonyms(tagName),
    staleTime: 60_000,
  });

  const otherSide = (a: string, b: string) => (a === tagName ? b : a);
  const aliases = relations.filter((r) => r.relation_type === 'alias').map((r) => otherSide(r.tag_a, r.tag_b));
  const related = relations.filter((r) => r.relation_type === 'related').map((r) => otherSide(r.tag_a, r.tag_b));

  // V4 エンジン: PMI + graph + cooccur + CTR で AI 関連タグ生成
  // shared synonyms も exclude — 既に明示的に表示されているので重複させない
  const v4Recommendations = useTagRecommendations(
    [tagName],
    [tagName, ...aliases, ...related, ...sharedSynonyms.map((s) => s.synonym)],
    8,
  );

  const { mutate: suggest } = useMutation({
    mutationFn: (other: string) => suggestTagRelation(tagName, other, mode ?? 'related'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-relations', tagName] });
      show('提案を送信しました', 'success');
      setMode(null);
    },
    onError: () => show('送信に失敗しました', 'error'),
  });

  // shared synonym 投票 (全ユーザーに反映)
  const { mutate: voteSynonym } = useMutation({
    mutationFn: async (other: string) => {
      const result = await voteTagSynonym(tagName, other);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-shared-synonyms', tagName] });
      show('みんなの synonym 候補に追加しました', 'success');
    },
    onError: () => show('投票に失敗しました', 'error'),
  });

  // AI 推薦タグに対するクイック「関連あり」アクション。
  // tag_relations テーブルに related レコードを INSERT (suggest API)。
  const { mutate: voteRelated } = useMutation({
    mutationFn: (other: string) => suggestTagRelation(tagName, other, 'related'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-relations', tagName] });
      show('「関連あり」を登録しました', 'success');
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '';
      show(msg ? `登録に失敗しました: ${msg}` : '登録に失敗しました', 'error');
    },
  });

  return (
    <View style={{ gap: SP['4'] }}>
      {aliases.length > 0 && (
        <Section title="🔗 同じ意味のタグ（エイリアス）" desc="このタグと同じものを指す別名">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {aliases.map((t) => (
              <TagPill key={t} name={t} state="alias" onPress={() => onTagPress(t)} />
            ))}
          </View>
        </Section>
      )}

      {groups.map((g) => (
        <GroupSection key={g.id} groupId={g.id} groupName={g.name} onTagPress={onTagPress} />
      ))}

      {related.length > 0 && (
        <Section title="🌿 関連タグ" desc="このタグと関係がある別のタグ">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {related.map((t) => (
              <TagPill key={t} name={t} state="group" onPress={() => onTagPress(t)} />
            ))}
          </View>
        </Section>
      )}

      {/* みんなの synonym (全ユーザー共有 投票ベース) */}
      {sharedSynonyms.length > 0 && (
        <Section title="🌍 みんなの同義語" desc="他のユーザーが「同じ意味」と投票したタグ">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {sharedSynonyms.map((s) => (
              <PressableScale
                key={s.synonym}
                onPress={() => onTagPress(s.synonym)}
                haptic="tap"
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: SP['3'], paddingVertical: SP['1'],
                  backgroundColor: s.is_confirmed ? C.sameGroupBg : C.bg3,
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: s.is_confirmed ? C.sameGroupBorder : C.border,
                }}
              >
                <Text style={[T.smallM, { color: s.is_confirmed ? C.sameGroup : C.text, fontWeight: '700' }]}>
                  #{s.synonym}
                </Text>
                {s.is_confirmed && (
                  <Text style={{ fontSize: 9, color: C.sameGroup, marginLeft: 2, fontWeight: '700' }}>
                    確定
                  </Text>
                )}
                <Text style={{ fontSize: 9, color: C.text3, marginLeft: 2 }}>
                  {s.vote_count}票
                </Text>
              </PressableScale>
            ))}
          </View>
        </Section>
      )}

      {/* V4 AI レコメンド */}
      {v4Recommendations.length > 0 && (
        <Section title="🤖 AI が選んだ関連タグ" desc="検索エンジン (PMI + グラフ + 共起 + CTR) で発見">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {v4Recommendations.map((r) => (
              <View key={r.tag} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <PressableScale
                  onPress={() => onTagPress(r.tag)}
                  haptic="tap"
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: SP['3'], paddingVertical: SP['1'],
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                    borderWidth: 1, borderColor: C.accentSoft,
                  }}
                >
                  <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>
                    #{r.tag}
                  </Text>
                  <Text style={{ fontSize: 9, color: C.text3, marginLeft: 2 }}>
                    {r.primaryReason}
                  </Text>
                </PressableScale>
                <PressableScale
                  onPress={() => voteSynonym(r.tag)}
                  haptic="select"
                  hitSlop={6}
                  accessibilityLabel={`#${r.tag} を同じ意味として登録`}
                  style={{
                    paddingHorizontal: SP['2'], paddingVertical: SP['1'],
                    borderRadius: R.full,
                    backgroundColor: C.bg3,
                    borderWidth: 1, borderColor: C.border,
                  }}
                >
                  <Text style={{ fontSize: 10, color: C.text2, fontWeight: '700' }}>
                    + 同じ意味
                  </Text>
                </PressableScale>
                <PressableScale
                  onPress={() => voteRelated(r.tag)}
                  haptic="select"
                  hitSlop={6}
                  accessibilityLabel={`#${r.tag} を関連ありとして登録`}
                  style={{
                    paddingHorizontal: SP['2'], paddingVertical: SP['1'],
                    borderRadius: R.full,
                    backgroundColor: C.bg3,
                    borderWidth: 1, borderColor: C.border,
                  }}
                >
                  <Text style={{ fontSize: 10, color: C.text2, fontWeight: '700' }}>
                    + 関連あり
                  </Text>
                </PressableScale>
              </View>
            ))}
          </View>
        </Section>
      )}

      <Section title="🛠️ タグの関連を提案" desc="同じ意味 or 関連あり と思うタグを登録">
        <View style={{ flexDirection: 'row', gap: SP['2'], marginBottom: SP['2'] }}>
          {(['alias', 'related'] as const).map((m) => (
            <PressableScale
              key={m}
              onPress={() => setMode(mode === m ? null : m)}
              haptic="select"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                borderRadius: R.full,
                backgroundColor: mode === m ? C.accent : C.bg3,
                borderWidth: 1,
                borderColor: mode === m ? C.accent : C.border,
              }}
            >
              <Text style={[T.small, { color: mode === m ? '#fff' : C.text2 }]}>
                {m === 'alias' ? '同じ意味' : '関連あり'}
              </Text>
            </PressableScale>
          ))}
        </View>
        {mode && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text style={[T.small, { color: C.text3 }]}>#{tagName} ↔</Text>
            <AddTagInline onSubmit={(t) => suggest(t)} />
          </View>
        )}
      </Section>
    </View>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <View style={{
      padding: SP['4'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }}>
      <Text style={[T.h4, { color: C.text }]}>{title}</Text>
      <Text style={[T.caption, { color: C.text3, marginBottom: SP['1'] }]}>{desc}</Text>
      {children}
    </View>
  );
}

function GroupSection({ groupId, groupName, onTagPress }: { groupId: string; groupName: string; onTagPress: (t: string) => void }) {
  const { data: members = [] } = useQuery({
    queryKey: ['tag-group-members', groupId],
    queryFn: () => fetchGroupMembers(groupId),
  });
  return (
    <Section title={`📦 ${groupName}`} desc="このグループに属するタグ">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
        {members.map((t) => (
          <TagPill key={t} name={t} state="group" onPress={() => onTagPress(t)} />
        ))}
      </View>
    </Section>
  );
}
