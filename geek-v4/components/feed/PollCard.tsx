import { useState, useRef } from 'react';
import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { usePollVote } from '../../hooks/usePolls';
import type { Poll } from '../../lib/api/polls';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';

// 期限切れ判定: 不正な expires_at (null / 壊れた文字列) でも throw しないように
function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);  // Date.parse は失敗時 NaN
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

export function PollCard({ poll }: { poll: Poll }) {
  const { vote } = usePollVote();
  const expired = isExpired(poll.expires_at);
  const showResults = poll.my_vote_option_ids.length > 0 || expired;
  const total = Math.max(1, poll.total_votes);
  // 連打防止: 投票送信中はボタンを無効化
  const [busy, setBusy] = useState<string | null>(null);
  const inflightRef = useRef(false);

  const handleVote = async (optionId: string) => {
    if (expired || inflightRef.current) return;
    inflightRef.current = true;
    setBusy(optionId);
    try {
      await vote(poll.id, optionId, poll.multi_select);
    } finally {
      inflightRef.current = false;
      setBusy(null);
    }
  };

  return (
    <View style={{
      marginHorizontal: SP['4'],
      marginTop: SP['2'],
      padding: SP['3'],
      backgroundColor: C.bg3,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 14 }}>📊</Text>
        <Text style={[T.smallM, { color: C.text, flex: 1, fontWeight: '700' }]}>
          {poll.question}
        </Text>
        {expired && (
          <View style={{
            paddingHorizontal: 6, paddingVertical: 2,
            backgroundColor: C.bg4, borderRadius: R.sm,
          }}>
            <Text style={[T.caption, { color: C.text3, fontSize: 10 }]}>終了</Text>
          </View>
        )}
      </View>
      <View style={{ gap: 6 }}>
        {poll.options.map((opt) => {
          const pct = showResults ? Math.round((opt.vote_count / total) * 100) : 0;
          const mine = poll.my_vote_option_ids.includes(opt.id);
          return (
            <PressableScale
              key={opt.id}
              onPress={() => handleVote(opt.id)}
              haptic="select"
              disabled={expired || busy !== null}
              style={{
                position: 'relative',
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                backgroundColor: C.bg2,
                borderRadius: R.md,
                borderWidth: 1.5,
                borderColor: mine ? C.accent : C.border,
                overflow: 'hidden',
                opacity: busy && busy !== opt.id ? 0.5 : 1,
              }}
            >
              {/* % バー */}
              {showResults && (
                <View style={{
                  position: 'absolute',
                  left: 0, top: 0, bottom: 0,
                  width: `${pct}%`,
                  backgroundColor: mine ? C.accentBg : C.bg3,
                }} />
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {mine && <Text style={{ fontSize: 11 }}>✓</Text>}
                <Text style={[T.smallM, { color: C.text, flex: 1, fontWeight: '700' }]}>
                  {opt.label}
                </Text>
                {showResults && (
                  <Text style={[T.smallM, { color: mine ? C.accent : C.text2, fontWeight: '700' }]}>
                    {pct}% ({opt.vote_count})
                  </Text>
                )}
              </View>
            </PressableScale>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Text style={[T.caption, { color: C.text3 }]}>
          投票 {poll.total_votes}件 {poll.multi_select ? '· 複数選択可' : ''}
        </Text>
        {poll.expires_at && !expired && (
          <Text style={[T.caption, { color: C.text3 }]}>
            · 終了 {formatRelative(poll.expires_at)}
          </Text>
        )}
      </View>
    </View>
  );
}
