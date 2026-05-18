import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { PressableScale } from '@/components/ui/PressableScale';
import { similarity as damerauSimilarity } from '@/lib/search/typoCorrect';
import { normalize } from '@/lib/search/tokenize';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

export type MentionTarget = { id: string; label: string };  // id = reply id or "#N", label = display

export function MentionAutocomplete({
  input,
  candidates,
  onPick,
}: {
  input: string;
  candidates: MentionTarget[];
  onPick: (target: MentionTarget) => void;
}) {
  // input から最後の '@' 以降のトークンを抽出
  const token = useMemo(() => {
    const at = input.lastIndexOf('@');
    if (at === -1) return null;
    const after = input.slice(at + 1);
    if (after.includes(' ') || after.includes('\n')) return null;
    return after;
  }, [input]);

  const matches = useMemo(() => {
    if (token === null) return [];
    if (token.length === 0) return candidates.slice(0, 5);
    const qn = normalize(token);
    const scored = candidates.map((c) => {
      const ln = normalize(c.label);
      let score = 0;
      if (ln === qn) score = 100;
      else if (ln.startsWith(qn)) score = 80;
      else if (ln.includes(qn)) score = 60;
      else {
        const sim = damerauSimilarity(qn, ln);
        if (sim >= 0.65) score = sim * 50;
      }
      return { c, score };
    }).filter((r) => r.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((r) => r.c);
  }, [token, candidates]);

  if (token === null || matches.length === 0) return null;

  return (
    <View style={{
      padding: SP['2'],
      backgroundColor: C.bg2,
      borderRadius: R.md,
      borderWidth: 1, borderColor: C.border,
      gap: 4,
    }}>
      <Text style={[T.caption, { color: C.text3, paddingHorizontal: 4 }]}>
        @ メンション候補
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {matches.map((m) => (
          <PressableScale
            key={m.id}
            onPress={() => onPick(m)}
            haptic="select"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['2'], paddingVertical: 4,
              backgroundColor: C.bg3, borderRadius: R.full,
              borderWidth: 1, borderColor: C.border,
            }}
          >
            <Text style={[T.smallM, { color: C.accent }]}>@{m.label}</Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}
