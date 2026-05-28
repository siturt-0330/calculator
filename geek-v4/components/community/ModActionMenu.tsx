// ============================================================
// components/community/ModActionMenu.tsx
// ------------------------------------------------------------
// コミュ管理人 (mod) が post / comment / BBS 返信 に対して
// 「削除 / 投稿者キック / 投稿者 BAN」を実行するための 3-dot menu。
//
// レイアウト:
//   - 3-dot icon (MoreHorizontal, 16px, C.text3) を tap で popover を開閉
//   - popover は GlassCard 風: rgba(20,20,22,0.95) + 1px border + SHADOW.md
//   - 3 つの item (削除 / キック / BAN) は destructive 系で C.red
//   - tap → ConfirmDialog (destructive=true) を開く
//   - ConfirmDialog 内に reason chip 行を embed する (Modal の中に Modal を
//     重ねず、確認 dialog そのもので理由選択も完結させる)
//
// API:
//   - 別 agent が lib/api/communityMods.ts に
//     deletePostAsMod / deleteCommentAsMod / deleteBBSReplyAsMod /
//     kickMember / banMember を定義する想定。
//   - 未定義の場合は dynamic import が失敗するので、catch して
//     「準備中です」toast を出すフォールバック。
//
// 表示制御:
//   - isMod=false or isOwn=true → null (mod でない / 自分の content は対象外)
// ============================================================

import { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { C, GRAD, R, SHADOW, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { Button } from '../ui/Button';
import { useToastStore } from '../../stores/toastStore';
import {
  MOD_BAN_REASONS,
  MOD_DELETE_REASONS,
  MOD_KICK_REASONS,
  getReasonsFor,
} from '../../lib/utils/modActionReasons';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type ModActionTarget =
  | { kind: 'post'; postId: string; authorId: string }
  | { kind: 'comment'; commentId: string; authorId: string; postId: string }
  | { kind: 'bbs_reply'; replyId: string; authorId: string; threadId: string };

export type ModAction = 'delete' | 'kick' | 'ban';

export type ModActionMenuProps = {
  /** 対象 (post / comment / bbs_reply) */
  target: ModActionTarget;
  /** mod 権限を持つコミュ ID */
  communityId: string;
  /** 現在のユーザーが mod かどうか */
  isMod: boolean;
  /** 自分のコンテンツかどうか (自分のは別経路で削除されるので非表示) */
  isOwn: boolean;
  /** 操作完了時のコールバック */
  onActionComplete?: (action: ModAction) => void;
};

// ------------------------------------------------------------
// 動的 import 用の型 (communityMods モジュールがまだ無いかもしれない)
// ------------------------------------------------------------
// 別 agent が定義していなくても type-check が落ちないように、
// import 戻り値を unknown 経由でガードする。

type CommunityModsApi = {
  deletePostAsMod?: (args: { postId: string; communityId: string; reason: string }) => Promise<unknown>;
  deleteCommentAsMod?: (args: { commentId: string; communityId: string; reason: string }) => Promise<unknown>;
  deleteBBSReplyAsMod?: (args: { replyId: string; communityId: string; reason: string }) => Promise<unknown>;
  kickMember?: (communityId: string, userId: string, reason: string) => Promise<unknown>;
  banMember?: (communityId: string, userId: string, reason: string) => Promise<unknown>;
};

function loadCommunityModsApi(): CommunityModsApi | null {
  // 別 agent が同時に書いている file。未存在の場合 require が throw する。
  // 動的 import は本 repo の tsconfig.module 設定で許可されないため、
  // 既存パターン (components/feed/MemeReactionPicker.tsx) と同じく require + try/catch を使う。
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('../../lib/api/communityMods') as unknown;
    if (mod && typeof mod === 'object') return mod as CommunityModsApi;
    return null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function actionToTitle(action: ModAction, target: ModActionTarget): string {
  if (action === 'delete') {
    if (target.kind === 'post') return 'この投稿を削除しますか？';
    if (target.kind === 'comment') return 'このコメントを削除しますか？';
    return 'この返信を削除しますか？';
  }
  if (action === 'kick') return '投稿者をコミュからキックしますか？';
  return '投稿者を BAN しますか？';
}

function actionToConfirmLabel(action: ModAction): string {
  if (action === 'delete') return '削除する';
  if (action === 'kick') return 'キックする';
  return 'BAN する';
}

function actionToSuccessMsg(action: ModAction): string {
  if (action === 'delete') return '削除しました';
  if (action === 'kick') return 'キックしました';
  return 'BAN しました';
}

// ------------------------------------------------------------
// Main component
// ------------------------------------------------------------

export function ModActionMenu({
  target,
  communityId,
  isMod,
  isOwn,
  onActionComplete,
}: ModActionMenuProps) {
  const show = useToastStore((s) => s.show);

  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ModAction | null>(null);
  const [selectedReasonKey, setSelectedReasonKey] = useState<string>('');
  const [freeText, setFreeText] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // hook 呼び出しは必ず early-return より前に置く (react-hooks/rules-of-hooks)
  const cancelConfirm = useCallback(() => {
    setPendingAction(null);
    setSelectedReasonKey('');
    setFreeText('');
    setSubmitting(false);
  }, []);

  // mod でない / 自分の content → 完全非表示
  if (!isMod || isOwn) return null;

  const openConfirm = (action: ModAction) => {
    setMenuOpen(false);
    setPendingAction(action);
    // preset 先頭を default 選択 (UX: chip がどれか選ばれている状態でスタート)
    const reasons = getReasonsFor(action);
    setSelectedReasonKey(reasons[0]?.key ?? '');
    setFreeText('');
  };

  const handleConfirm = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    const reasonKey = selectedReasonKey;
    const reason =
      reasonKey === 'other'
        ? freeText.trim().slice(0, 200) || 'その他'
        : reasonKey || 'unspecified';

    setSubmitting(true);
    const api = loadCommunityModsApi();

    // API 未定義 → 「準備中です」toast を出して dialog を閉じる
    const runFallback = () => {
      show('準備中です', 'info');
      cancelConfirm();
    };

    try {
      if (action === 'delete') {
        if (target.kind === 'post') {
          if (!api?.deletePostAsMod) return runFallback();
          await api.deletePostAsMod({ postId: target.postId, communityId, reason });
        } else if (target.kind === 'comment') {
          if (!api?.deleteCommentAsMod) return runFallback();
          await api.deleteCommentAsMod({ commentId: target.commentId, communityId, reason });
        } else {
          if (!api?.deleteBBSReplyAsMod) return runFallback();
          await api.deleteBBSReplyAsMod({ replyId: target.replyId, communityId, reason });
        }
      } else if (action === 'kick') {
        if (!api?.kickMember) return runFallback();
        await api.kickMember(communityId, target.authorId, reason);
      } else {
        if (!api?.banMember) return runFallback();
        await api.banMember(communityId, target.authorId, reason);
      }

      show(actionToSuccessMsg(action), 'success');
      onActionComplete?.(action);
      cancelConfirm();
    } catch (e) {
      // API 関数自体は存在したが処理が失敗 — error toast
      const msg = e instanceof Error ? e.message : '操作に失敗しました';
      show(msg, 'error');
      setSubmitting(false);
    }
  };

  // ----- Render -----
  return (
    <>
      {/* 3-dot trigger */}
      <PressableScale
        onPress={() => setMenuOpen(true)}
        haptic="tap"
        hitSlop={10}
        accessibilityLabel="管理人メニューを開く"
        style={{ padding: SP['2'] }}
      >
        <Icon.more size={16} color={C.text3} strokeWidth={2.2} />
      </PressableScale>

      {/* Popover (Modal で全画面 backdrop → tap で閉じる) */}
      <Modal
        transparent
        visible={menuOpen}
        animationType="none"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(140)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'flex-end',
            padding: SP['4'],
          }}
        >
          <Pressable
            onPress={() => setMenuOpen(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            accessibilityLabel="メニューを閉じる"
          />
          <Animated.View
            entering={ZoomIn.duration(180)}
            exiting={ZoomOut.duration(140)}
            style={{
              backgroundColor: 'rgba(20,20,22,0.95)',
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
              overflow: 'hidden',
              ...SHADOW.md,
            }}
          >
            <MenuItem
              icon={<Icon.trash size={18} color={C.red} strokeWidth={2.2} />}
              label={
                target.kind === 'post'
                  ? 'この投稿を削除'
                  : target.kind === 'comment'
                    ? 'このコメントを削除'
                    : 'この返信を削除'
              }
              danger
              onPress={() => openConfirm('delete')}
            />
            <Divider />
            <MenuItem
              icon={<Icon.logout size={18} color={C.red} strokeWidth={2.2} />}
              label="投稿者をキック"
              danger
              onPress={() => openConfirm('kick')}
            />
            <Divider />
            <MenuItem
              icon={<Icon.block size={18} color={C.red} strokeWidth={2.2} />}
              label="投稿者を BAN"
              danger
              onPress={() => openConfirm('ban')}
            />
            <Divider />
            <MenuItem
              icon={<Icon.close size={18} color={C.text2} strokeWidth={2.2} />}
              label="キャンセル"
              onPress={() => setMenuOpen(false)}
            />
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* Confirm + reason picker (Modal を 1 つだけ使う設計) */}
      <Modal
        transparent
        visible={pendingAction !== null}
        animationType="none"
        onRequestClose={cancelConfirm}
      >
        {pendingAction && (
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(160)}
            style={{
              flex: 1,
              backgroundColor: C.scrim,
              alignItems: 'center',
              justifyContent: 'center',
              padding: SP['4'],
            }}
          >
            <Pressable
              onPress={cancelConfirm}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            <Animated.View
              entering={ZoomIn.duration(220)}
              exiting={ZoomOut.duration(160)}
              style={{
                width: '100%',
                maxWidth: 420,
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                padding: SP['4'],
                gap: SP['4'],
                ...SHADOW.md,
              }}
            >
              <Text style={[T.h3, { color: C.text, fontWeight: '700' }]}>
                {actionToTitle(pendingAction, target)}
              </Text>
              <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>
                理由を選択してください。「その他」を選ぶと自由入力できます。
              </Text>

              {/* Reason chip 行 — 横スクロールで chip を並べる */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: SP['2'], paddingVertical: SP['1'] }}
              >
                {(pendingAction === 'delete'
                  ? MOD_DELETE_REASONS
                  : pendingAction === 'kick'
                    ? MOD_KICK_REASONS
                    : MOD_BAN_REASONS
                ).map((r) => {
                  const selected = r.key === selectedReasonKey;
                  return (
                    <PressableScale
                      key={r.key}
                      onPress={() => setSelectedReasonKey(r.key)}
                      haptic="select"
                      style={{
                        paddingHorizontal: SP['3'],
                        paddingVertical: SP['2'],
                        borderRadius: R.full,
                        borderWidth: 1,
                        borderColor: selected ? C.accent : C.border,
                        backgroundColor: selected ? C.accentSoft : C.bg3,
                      }}
                    >
                      <Text
                        style={[
                          T.smallM,
                          { color: selected ? C.accentLight : C.text2 },
                        ]}
                      >
                        {r.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>

              {/* free-text 入力 (key === 'other' のみ) */}
              {selectedReasonKey === 'other' && (
                <View
                  style={{
                    backgroundColor: C.bg3,
                    borderRadius: R.lg,
                    borderWidth: 1,
                    borderColor: C.border,
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['2'],
                  }}
                >
                  <TextInput
                    value={freeText}
                    onChangeText={setFreeText}
                    placeholder="理由を入力 (200 字以内)"
                    placeholderTextColor={C.text3}
                    maxLength={200}
                    multiline
                    style={[
                      T.body,
                      { color: C.text, minHeight: 60, textAlignVertical: 'top' },
                    ]}
                  />
                </View>
              )}

              {/* destructive accent: 赤グラデ風 (Button variant=danger で実体は赤) */}
              <View style={{ gap: SP['2'], marginTop: SP['2'] }}>
                <Button
                  label={actionToConfirmLabel(pendingAction)}
                  onPress={handleConfirm}
                  variant="danger"
                  size="lg"
                  fullWidth
                  haptic="warn"
                  disabled={
                    submitting ||
                    (selectedReasonKey === 'other' && freeText.trim().length === 0)
                  }
                />
                <Button
                  label="キャンセル"
                  onPress={cancelConfirm}
                  variant="ghost"
                  size="lg"
                  fullWidth
                  haptic="tap"
                  disabled={submitting}
                />
              </View>

              {/* GRAD.destructive を視覚的に使う subtle bar (header 下に細いライン) */}
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  height: 3,
                  borderTopLeftRadius: R.lg,
                  borderTopRightRadius: R.lg,
                  // GRAD.destructive の先頭色を使ったベタ塗り line (LinearGradient 依存を避ける)
                  backgroundColor: GRAD.destructive[0],
                  opacity: 0.7,
                }}
              />
            </Animated.View>
          </Animated.View>
        )}
      </Modal>
    </>
  );
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------

function MenuItem({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic={danger ? 'warn' : 'tap'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingHorizontal: SP['4'],
        paddingVertical: SP['3'],
      }}
    >
      {icon}
      <Text style={[T.bodyM, { color: danger ? C.red : C.text }]}>{label}</Text>
    </PressableScale>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />;
}
