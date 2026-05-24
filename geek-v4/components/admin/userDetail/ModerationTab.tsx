// ============================================================
// userDetail/ModerationTab — admin/user/[id] の Tab 3 (モデレーション timeline)
// ============================================================
// メモ composer (note action として moderation_log に直接 insert) +
// 過去の管理アクションを timeline rail で表示。
// actionMeta は ModerationTab 専用なので同居 (parent screen からも使わない)。
// ============================================================
import { useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { PressableScale } from '../../ui/PressableScale';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { formatRelative } from '../../../lib/utils/date';
import { supabase } from '../../../lib/supabase';
import { useToastStore } from '../../../stores/toastStore';
import type { ModerationLog } from '../../../lib/api/admin';
import { UserDetailEmptyState } from './_shared';

// moderation_log の action 列 → 表示用 emoji + 日本語ラベル。
function actionMeta(action: string): { emoji: string; label: string; color: string } {
  switch (action) {
    case 'suspend':      return { emoji: '🚫', label: '凍結',     color: C.red };
    case 'unsuspend':    return { emoji: '✅', label: '凍結解除', color: C.green };
    case 'delete_post':  return { emoji: '🗑️', label: '投稿削除', color: C.red };
    case 'delete_all':   return { emoji: '🧹', label: '全削除',   color: C.red };
    case 'reset_state':  return { emoji: '🔄', label: 'リセット', color: C.accent };
    case 'send_message': return { emoji: '📧', label: 'DM 送信',  color: C.blue };
    case 'note':         return { emoji: '📝', label: 'メモ',     color: C.text2 };
    default:             return { emoji: '•',  label: action,     color: C.text3 };
  }
}

export function ModerationTab({ logs, userId }: { logs: ModerationLog[]; userId: string }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  // メモを moderation_log に 'note' action として書き込む。
  // sendAdminMessage 系は本人に通知が飛ぶので使えない — 直接 insert。
  const saveNote = async () => {
    const trimmed = note.trim();
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const adminId = auth.user?.id;
      if (!adminId) throw new Error('not signed in');
      const { error } = await supabase.from('moderation_log').insert({
        admin_id: adminId,
        action: 'note',
        target_type: 'user',
        target_id: userId,
        reason: trimmed,
      });
      if (error) throw error;
      setNote('');
      show('メモを保存しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-user', userId] });
    } catch {
      show('メモの保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
      {/* note composer */}
      <View
        style={[{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          padding: SP['3'],
          gap: SP['2'],
        }, SHADOW.card]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>📝</Text>
          <Text style={[T.smallB, { color: C.text2 }]}>メモを残す</Text>
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="このユーザーに関する社内メモ…"
          placeholderTextColor={C.text4}
          multiline
          style={[
            T.body,
            {
              color: C.text,
              backgroundColor: C.bg3,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              padding: SP['3'],
              minHeight: 72,
              textAlignVertical: 'top',
            },
          ]}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <PressableScale
            onPress={() => { void saveNote(); }}
            haptic="confirm"
            disabled={saving || note.trim().length === 0}
            style={[
              {
                paddingHorizontal: SP['4'], paddingVertical: SP['2'],
                backgroundColor: note.trim().length === 0 ? C.bg3 : C.accent,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: note.trim().length === 0 ? C.border : C.accent,
                flexDirection: 'row', alignItems: 'center', gap: 6,
                opacity: saving ? 0.6 : 1,
              },
              note.trim().length > 0 ? SHADOW.accentGlow : null,
            ]}
          >
            {saving && <ActivityIndicator size="small" color="#fff" />}
            <Text
              style={[
                T.smallB,
                { color: note.trim().length === 0 ? C.text3 : '#fff' },
              ]}
            >
              保存
            </Text>
          </PressableScale>
        </View>
      </View>

      {logs.length === 0 ? (
        <UserDetailEmptyState icon="📜" title="履歴はありません" hint="まだ何のアクションも記録されていません" />
      ) : (
        <View style={{ paddingLeft: 4 }}>
          {logs.map((l, i) => {
            const meta = actionMeta(l.action);
            const isLast = i === logs.length - 1;
            return (
              <Animated.View
                key={l.id}
                entering={FadeInDown.duration(220).delay(i * 25)}
                layout={Layout.springify()}
                style={{ flexDirection: 'row', gap: SP['3'] }}
              >
                {/* timeline rail */}
                <View style={{ alignItems: 'center', width: 28 }}>
                  <View
                    style={{
                      width: 28, height: 28,
                      borderRadius: 14,
                      backgroundColor: C.bg3,
                      borderWidth: 1.5,
                      borderColor: meta.color + '88',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 12 }}>{meta.emoji}</Text>
                  </View>
                  {!isLast && (
                    <View
                      style={{
                        width: 2,
                        flex: 1,
                        minHeight: 24,
                        backgroundColor: C.divider,
                      }}
                    />
                  )}
                </View>

                {/* node body */}
                <View
                  style={[{
                    flex: 1,
                    marginBottom: SP['2'],
                    padding: SP['3'],
                    backgroundColor: C.bg2,
                    borderRadius: R.lg,
                    borderWidth: 1,
                    borderColor: C.border,
                    borderLeftWidth: 3,
                    borderLeftColor: meta.color,
                    gap: 4,
                  }, SHADOW.card]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                    <Text style={[T.smallB, { color: meta.color, flex: 1 }]} numberOfLines={1}>
                      {meta.label}
                    </Text>
                    <Text style={[T.caption, { color: C.text4 }]}>
                      {formatRelative(l.created_at)}
                    </Text>
                  </View>
                  <Text style={[T.mono, { color: C.text3, fontSize: 10 }]} numberOfLines={1}>
                    admin: {l.admin_id.slice(0, 8)}
                  </Text>
                  {l.reason && (
                    <Text style={[T.small, { color: C.text2, lineHeight: 18 }]} numberOfLines={6}>
                      {l.reason}
                    </Text>
                  )}
                </View>
              </Animated.View>
            );
          })}
        </View>
      )}
    </View>
  );
}
