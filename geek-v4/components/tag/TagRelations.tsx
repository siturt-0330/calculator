import { useState, useMemo } from 'react';
import { View, Text } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TagPill } from './TagPill';
import { AddTagInline } from './AddTagInline';
import { PressableScale } from '@/components/ui/PressableScale';
import { useToastStore } from '@/stores/toastStore';
import { useTagRecommendations } from '@/hooks/useTagRecommendations';
import {
  fetchTagRelations,
  fetchGroupsForTag,
  fetchGroupMembers,
  suggestTagRelation,
} from '@/lib/api/tags';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

export function TagRelations({
  tagName,
  onTagPress,
}: {
  tagName: string;
  onTagPress: (t: string) => void;
}) {
  const qc = useQueryClient();
  const { show } = useToastStore();
  const [mode, setMode] = useState<'alias' | 'related' | null>(null);

  const { data: relations = [] } = useQuery({
    queryKey: ['tag-relations', tagName],
    queryFn: () => fetchTagRelations(tagName),
  });
  const { data: groups = [] } = useQuery({
    queryKey: ['tag-groups', tagName],
    queryFn: () => fetchGroupsForTag(tagName),
  });

  const otherSide = (a: string, b: string) => (a === tagName ? b : a);
  const aliases = relations.filter((r) => r.relation_type === 'alias').map((r) => otherSide(r.tag_a, r.tag_b));
  const related = relations.filter((r) => r.relation_type === 'related').map((r) => otherSide(r.tag_a, r.tag_b));

  // V4 エンジン: PMI + graph + cooccur + CTR で AI 関連タグ生成
  const v4Recommendations = useTagRecommendations(
    [tagName],
    [tagName, ...aliases, ...related],
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

      {/* V4 AI レコメンド */}
      {v4Recommendations.length > 0 && (
        <Section title="🤖 AI が選んだ関連タグ" desc="検索エンジン (PMI + グラフ + 共起 + CTR) で発見">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {v4Recommendations.map((r) => (
              <PressableScale
                key={r.tag}
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
