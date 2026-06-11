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
  highlightBg = C.accentSoft,
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

  // segment に開始 offset(at)を持たせ index ではなく offset ベースの安定キーにする (§14: key={i} 回避)。
  // findHighlightRanges は merge 済み非重複 range を返すため at は一意=衝突なし。
  const segments: { t: string; hi: boolean; at: number }[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) segments.push({ t: text.slice(cursor, r.start), hi: false, at: cursor });
    segments.push({ t: text.slice(r.start, r.end), hi: true, at: r.start });
    cursor = r.end;
  }
  if (cursor < text.length) segments.push({ t: text.slice(cursor), hi: false, at: cursor });

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((s) =>
        s.hi ? (
          <Text key={`h-${s.at}`} style={{ color: highlightColor, fontWeight: '800', backgroundColor: highlightBg }}>
            {s.t}
          </Text>
        ) : (
          <Text key={`p-${s.at}`}>{s.t}</Text>
        ),
      )}
    </Text>
  );
}
