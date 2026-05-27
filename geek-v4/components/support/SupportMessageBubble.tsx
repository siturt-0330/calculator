// ============================================================
// SupportMessageBubble — Modmail 詳細画面のメッセージバブル
// ============================================================
// レイアウト規則:
//   - 自分メッセージ (own=true): 右寄せ、背景 C.accentBg、border C.accent 薄、R.lg
//   - 運営メッセージ (own=false): 左寄せ、GlassCard pattern、「運営」label + shield icon
// timestamp は T.caption C.text3 で吹き出し下の小さい文字
// ============================================================
import { View, Text } from 'react-native';
import { GlassCard } from '../ui/GlassCard';
import { Icon } from '../../constants/icons';
import { formatRelative } from '../../lib/utils/date';
import type { SupportMessage } from '../../lib/api/support';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

type Props = {
  message: SupportMessage;
  /** このバブルが現在ログイン中のユーザー自身の発言か */
  own: boolean;
};

export function SupportMessageBubble({ message, own }: Props) {
  // is_admin_reply は「運営側からの返信」を意味する。
  // - own=true (自分):
  //     - 通常 user → is_admin_reply=false (右側に水色寄りの自分バブル)
  //     - admin が自分でスレッドを開いた場合 → is_admin_reply=true (右側だが「運営」ラベル付き)
  // - own=false:
  //     - 普通の user スレッドを admin が見たケース → 相手側は user
  //     - user 視点で運営返信を見たケース → 相手側は admin (運営バッジ)
  const isAdminReply = message.is_admin_reply;

  if (own) {
    // 自分側: 右寄せ、accent 系背景
    return (
      <View
        style={{
          alignSelf: 'flex-end',
          maxWidth: '85%',
          marginBottom: SP['2'],
          gap: 2,
        }}
      >
        <View
          style={[
            {
              paddingVertical: SP['2'],
              paddingHorizontal: SP['3'],
              backgroundColor: C.accentBg,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.accent + '44',
              // 右下を少し角ばらせて吹き出しの向きを示唆
              borderBottomRightRadius: R.sm,
            },
            SHADOW.xs,
          ]}
        >
          {/* admin が自分で書いた発言なら「運営」ラベルを上に */}
          {isAdminReply && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                marginBottom: 4,
              }}
            >
              <Icon.shield size={11} color={C.accentLight} strokeWidth={2.4} />
              <Text
                style={[
                  T.caption,
                  { color: C.accentLight, fontWeight: '800', letterSpacing: 0.4 },
                ]}
              >
                運営
              </Text>
            </View>
          )}
          <Text style={[T.body, { color: C.text, lineHeight: 21 }]} selectable>
            {message.content}
          </Text>
        </View>
        <Text
          style={[
            T.caption,
            { color: C.text3, alignSelf: 'flex-end', paddingHorizontal: SP['1'] },
          ]}
        >
          あなた · {formatRelative(message.created_at)}
        </Text>
      </View>
    );
  }

  // 相手側: 左寄せ、GlassCard
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: '85%',
        marginBottom: SP['2'],
        gap: 2,
      }}
    >
      <GlassCard
        style={{
          padding: SP['3'],
          borderBottomLeftRadius: R.sm,
        }}
      >
        {isAdminReply ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginBottom: 4,
            }}
          >
            <Icon.shield size={11} color={C.accent} strokeWidth={2.4} />
            <Text style={[T.caption, { color: C.accent, fontWeight: '800', letterSpacing: 0.4 }]}>
              運営
            </Text>
          </View>
        ) : (
          <Text
            style={[
              T.caption,
              { color: C.text3, fontWeight: '700', marginBottom: 4, letterSpacing: 0.3 },
            ]}
          >
            ユーザー
          </Text>
        )}
        <Text style={[T.body, { color: C.text, lineHeight: 21 }]} selectable>
          {message.content}
        </Text>
      </GlassCard>
      <Text style={[T.caption, { color: C.text3, paddingHorizontal: SP['1'] }]}>
        {formatRelative(message.created_at)}
      </Text>
    </View>
  );
}
