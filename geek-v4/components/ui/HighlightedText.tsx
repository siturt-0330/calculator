import { Text, type TextStyle, type StyleProp } from 'react-native';
import { findHighlightRanges } from '../../lib/search/scoring';
import { C } from '../../design/tokens';

// 検索クエリにマッチした部分をハイライト表示
export function HighlightedText({
  text,
  terms,
  numberOfLines,
  style,
  highlightColor = C.accent,
  highlightBg = 'rgba(124,106,247,0.2)',
}: {
  text: string;
  terms: string[];
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  highlightColor?: string;
  highlightBg?: string;
}) {
  if (!text) return <Text style={style}>{text}</Text>;
  const cleanTerms = terms.filter((t) => t && t.length > 0);
  if (cleanTerms.length === 0) return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  const ranges = findHighlightRanges(text, cleanTerms);
  if (ranges.length === 0) return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;

  const segments: { t: string; hi: boolean }[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) segments.push({ t: text.slice(cursor, r.start), hi: false });
    segments.push({ t: text.slice(r.start, r.end), hi: true });
    cursor = r.end;
  }
  if (cursor < text.length) segments.push({ t: text.slice(cursor), hi: false });

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((s, i) =>
        s.hi ? (
          <Text key={i} style={{ color: highlightColor, fontWeight: '800', backgroundColor: highlightBg }}>
            {s.t}
          </Text>
        ) : (
          <Text key={i}>{s.t}</Text>
        ),
      )}
    </Text>
  );
}
