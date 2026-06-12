import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { TagPill } from './TagPill';
import { PressableScale } from '../ui/PressableScale';
import {
  fetchTagRelations,
  fetchGroupsForTag,
  fetchGroupMembers,
} from '../../lib/api/tags';
import { fetchTagSynonyms } from '../../lib/api/tagSynonyms';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export function TagRelations({
  tagName,
  onTagPress,
}: {
  tagName: string;
  onTagPress: (t: string) => void;
}) {
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
                  <Text style={{ fontSize: 11, color: C.sameGroup, marginLeft: 2, fontWeight: '700' }}>
                    確定
                  </Text>
                )}
                <Text style={{ fontSize: 11, color: C.text3, marginLeft: 2 }}>
                  {s.vote_count}票
                </Text>
              </PressableScale>
            ))}
          </View>
        </Section>
      )}

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
