import { Text, Linking, Platform } from 'react-native';
import type { TextStyle, StyleProp } from 'react-native';
import { C } from '../../design/tokens';
import { sanitizeUrl } from '../../lib/sanitize';

// 軽量 inline Markdown レンダラ
// 対応: **bold**, *italic*, `code`, ~~strike~~, [text](url)
// マルチライン段落は素のテキストとして折り返す
type Segment =
  | { kind: 'plain'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'link'; text: string; href: string };

function parse(input: string): Segment[] {
  const segments: Segment[] = [];
  // 順序: link → code → bold → strike → italic
  // 各 token を正規表現で食い、残った間は plain
  const re = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(`([^`\n]+)`)|(\*\*([^*\n]+)\*\*)|(~~([^~\n]+)~~)|(\*([^*\n]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) {
      segments.push({ kind: 'plain', text: input.slice(last, m.index) });
    }
    if (m[1]) {
      // [text](url)
      segments.push({ kind: 'link', text: m[2] ?? '', href: m[3] ?? '' });
    } else if (m[4]) {
      segments.push({ kind: 'code', text: m[5] ?? '' });
    } else if (m[6]) {
      segments.push({ kind: 'bold', text: m[7] ?? '' });
    } else if (m[8]) {
      segments.push({ kind: 'strike', text: m[9] ?? '' });
    } else if (m[10]) {
      segments.push({ kind: 'italic', text: m[11] ?? '' });
    }
    last = m.index + m[0].length;
  }
  if (last < input.length) {
    segments.push({ kind: 'plain', text: input.slice(last) });
  }
  return segments;
}

export function MarkdownText({
  text,
  style,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const segs = parse(text);

  const open = (url: string) => {
    // パーサ regex は https? のみ通すが、defense-in-depth で再検証
    const safe = sanitizeUrl(url);
    if (!safe) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(safe, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(safe).catch(() => {});
    }
  };

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segs.map((s, i) => {
        switch (s.kind) {
          case 'bold':
            return <Text key={i} style={{ fontWeight: '700' }}>{s.text}</Text>;
          case 'italic':
            return <Text key={i} style={{ fontStyle: 'italic' }}>{s.text}</Text>;
          case 'code':
            return (
              <Text key={i} style={{
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                backgroundColor: C.bg3,
                color: C.accent,
              }}>
                {' '}{s.text}{' '}
              </Text>
            );
          case 'strike':
            return <Text key={i} style={{ textDecorationLine: 'line-through' }}>{s.text}</Text>;
          case 'link':
            return (
              <Text key={i} style={{ color: C.accent, textDecorationLine: 'underline' }} onPress={() => open(s.href)}>
                {s.text}
              </Text>
            );
          default:
            return <Text key={i}>{s.text}</Text>;
        }
      })}
    </Text>
  );
}
