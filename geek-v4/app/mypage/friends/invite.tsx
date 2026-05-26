// ============================================================
// app/mypage/friends/invite.tsx
// ============================================================
// 招待コード生成 + 一覧表示 + コピー / 共有 / 削除。
// - useMyInvites で既存の招待を取得 (有効期限内 + 未使用 を上位に並べる)
// - useCreateInvite で新規発行
// - useRevokeInvite で削除
// - Web: navigator.share / native: Share.share で共有 (Platform.OS で分岐)
// - コピーは expo-clipboard
// - 期限切れ表示は date-fns formatDistanceToNow (ja locale)
// ============================================================

import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Platform,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Button } from '../../../components/ui/Button';
import { Icon } from '../../../constants/icons';
import {
  useMyInvites,
  useCreateInvite,
  useRevokeInvite,
} from '../../../hooks/useFriendInvites';
import { inviteUrlFor } from '../../../lib/api/friends';
import { useToastStore } from '../../../stores/toastStore';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import type { FriendInvite } from '../../../types/models';

// ============================================================
// 招待リンク 1 枚のカード
// ============================================================
function InviteCard({
  invite,
  onCopy,
  onShare,
  onRevoke,
  busyRevoke,
}: {
  invite: FriendInvite;
  onCopy: () => void;
  onShare: () => void;
  onRevoke: () => void;
  busyRevoke: boolean;
}) {
  const url = inviteUrlFor(invite.code);
  // expires_at は string なので、識別子としては string をそのまま useMemo deps に渡す
  // (毎 render で new Date() するとオブジェクト参照が変わって useMemo が無効化する)
  const expiresAtIso = invite.expires_at;
  const isUsed = !!invite.used_by;

  // 期限切れ表示。date-fns で "あと約3日" / "3日前" 等を出す。
  // isExpired / expiryLabel を 1 つの useMemo にまとめて Date オブジェクトの再生成を抑える。
  const { isExpired, expiryLabel } = useMemo(() => {
    const d = new Date(expiresAtIso);
    const expired = d.getTime() < Date.now();
    try {
      const distance = formatDistanceToNow(d, { locale: ja });
      return {
        isExpired: expired,
        expiryLabel: expired ? `${distance}前に期限切れ` : `あと約${distance}`,
      };
    } catch {
      return { isExpired: expired, expiryLabel: '' };
    }
  }, [expiresAtIso]);

  // 状態バッジの色: 使用済 > 期限切れ > 有効
  const statusBadge = isUsed
    ? { label: '使用済み', bg: C.bg3, fg: C.text3 }
    : isExpired
      ? { label: '期限切れ', bg: C.redBg, fg: C.red }
      : { label: '有効', bg: C.greenBg, fg: C.green };

  const disabled = isUsed || isExpired;

  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: disabled ? C.border : C.accent + '44',
        gap: SP['3'],
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {/* 状態バッジ + 期限 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <View
          style={{
            paddingHorizontal: SP['2'],
            paddingVertical: 2,
            backgroundColor: statusBadge.bg,
            borderRadius: R.sm,
          }}
        >
          <Text style={[T.caption, { color: statusBadge.fg, fontWeight: '700' }]}>
            {statusBadge.label}
          </Text>
        </View>
        <Text style={[T.caption, { color: C.text3 }]}>{expiryLabel}</Text>
      </View>

      {/* code (大きく monospace 表示) */}
      <Text
        style={[
          T.mono,
          {
            color: C.text,
            fontSize: 20,
            letterSpacing: 2,
            textAlign: 'center',
            paddingVertical: SP['2'],
          },
        ]}
        selectable
      >
        {invite.code}
      </Text>

      {/* 完全な URL */}
      <Text
        style={[T.caption, { color: C.text3, textAlign: 'center' }]}
        numberOfLines={1}
        selectable
      >
        {url}
      </Text>

      {/* アクション群 */}
      <View style={{ flexDirection: 'row', gap: SP['2'] }}>
        <PressableScale
          onPress={onCopy}
          haptic="tap"
          disabled={disabled}
          style={{
            flex: 1,
            paddingVertical: SP['2'],
            borderRadius: R.full,
            backgroundColor: C.bg3,
            borderWidth: 1,
            borderColor: C.border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: SP['1'],
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Icon.save size={14} color={C.text2} strokeWidth={2.2} />
          <Text style={[T.smallM, { color: C.text2 }]}>コピー</Text>
        </PressableScale>
        <PressableScale
          onPress={onShare}
          haptic="confirm"
          disabled={disabled}
          style={{
            flex: 1,
            paddingVertical: SP['2'],
            borderRadius: R.full,
            backgroundColor: disabled ? C.bg3 : C.accent,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: SP['1'],
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Icon.share size={14} color="#fff" strokeWidth={2.2} />
          <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
            共有
          </Text>
        </PressableScale>
        <PressableScale
          onPress={onRevoke}
          haptic="warn"
          disabled={busyRevoke}
          style={{
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'],
            borderRadius: R.full,
            backgroundColor: C.redBg,
            borderWidth: 1,
            borderColor: C.red + '44',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: busyRevoke ? 0.5 : 1,
          }}
          accessibilityLabel="この招待を削除"
        >
          {busyRevoke ? (
            <ActivityIndicator size="small" color={C.red} />
          ) : (
            <Icon.trash size={16} color={C.red} strokeWidth={2.2} />
          )}
        </PressableScale>
      </View>
    </View>
  );
}

// ============================================================
// メイン screen
// ============================================================
export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const show = useToastStore((s) => s.show);
  const { invites, isLoading } = useMyInvites();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();

  // 有効 (= 未使用 + 期限内) を先頭、それ以外を後ろ。同じグループ内では新しい順。
  // hook 側で created_at desc は既に取れているので、ここでは valid フラグで安定 sort。
  const sortedInvites = useMemo(() => {
    const now = Date.now();
    const isValid = (inv: FriendInvite): boolean =>
      !inv.used_by && new Date(inv.expires_at).getTime() > now;
    return [...invites].sort((a, b) => {
      const va = isValid(a) ? 0 : 1;
      const vb = isValid(b) ? 0 : 1;
      if (va !== vb) return va - vb;
      // 同じグループは新しい順 (created_at desc)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [invites]);

  // ============================================================
  // コピー (expo-clipboard)
  // ============================================================
  const handleCopy = async (code: string) => {
    const url = inviteUrlFor(code);
    try {
      await Clipboard.setStringAsync(url);
      show('コピーしました', 'success');
    } catch {
      show('コピーに失敗しました', 'error');
    }
  };

  // ============================================================
  // 共有 — Web は navigator.share、native は Share.share
  // ============================================================
  // Platform.OS === 'web' のみ window.navigator.share が使える環境 (iOS Safari /
  // Android Chrome) があり、それ以外 (Desktop Firefox など) は clipboard へ fallback。
  // native (iOS / Android) は React Native の Share API を使う。
  const handleShare = async (code: string) => {
    const url = inviteUrlFor(code);
    const message = `GEEK で友達になろう！\n${url}`;

    if (Platform.OS === 'web') {
      // Web: navigator.share が使える環境ならそれを優先
      const nav =
        typeof navigator !== 'undefined'
          ? (navigator as Navigator & { share?: (data: ShareData) => Promise<void> })
          : null;
      if (nav && typeof nav.share === 'function') {
        try {
          await nav.share({
            title: 'GEEK 友達招待',
            text: message,
            url,
          });
          return;
        } catch (e) {
          // ユーザー cancel (AbortError) は無視
          const err = e as { name?: string };
          if (err?.name === 'AbortError') return;
          // それ以外は clipboard fallback
        }
      }
      // fallback: clipboard
      try {
        await Clipboard.setStringAsync(url);
        show('リンクをコピーしました', 'success');
      } catch {
        show('共有に失敗しました', 'error');
      }
      return;
    }

    // Native: react-native Share
    try {
      await Share.share({ message, url, title: 'GEEK 友達招待' });
    } catch (e) {
      // ユーザー cancel は React Native では reject されないが念のため
      const msg = e instanceof Error ? e.message : '';
      if (msg.toLowerCase().includes('user did not share')) return;
      show('共有に失敗しました', 'error');
    }
  };

  // ============================================================
  // 新規発行
  // ============================================================
  const handleCreate = () => {
    create.mutate(undefined, {
      onSuccess: (data) => {
        show(`新しい招待コードを作成しました (${data.code})`, 'success');
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : '招待コードの作成に失敗しました';
        show(msg, 'error');
      },
    });
  };

  // ============================================================
  // 削除
  // ============================================================
  // 各 row の削除中表示用に code を保持。
  // (mutation は globally 1 つ。複数行で同時実行は仕様上ない想定だが、UI 上で
  //  どの行が処理中か明示できるように。)
  const revokingCode =
    revoke.isPending && revoke.variables
      ? (revoke.variables as string)
      : null;

  const handleRevoke = (code: string) => {
    revoke.mutate(code, {
      onSuccess: () => show('招待を削除しました', 'info'),
      onError: (e) => {
        const msg = e instanceof Error ? e.message : '削除に失敗しました';
        show(msg, 'error');
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="友達を招待" left={<BackButton />} />

      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
      >
        {/* ヘッダー説明 */}
        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.accentBg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.accentSoft,
            flexDirection: 'row',
            gap: SP['3'],
            alignItems: 'flex-start',
          }}
        >
          <Icon.friends size={22} color={C.accent} strokeWidth={2} />
          <Text style={[T.small, { color: C.text2, flex: 1, lineHeight: 20 }]}>
            招待リンクを送って友達に登録してもらおう。リンクは 7 日間有効です。
          </Text>
        </View>

        {/* 新規発行 button */}
        <Button
          label={create.isPending ? '作成中…' : '+ 新しい招待コードを作る'}
          onPress={handleCreate}
          variant="primary"
          size="md"
          fullWidth
          loading={create.isPending}
          haptic="confirm"
        />

        {/* 招待一覧 */}
        {isLoading ? (
          <View
            style={{
              paddingVertical: SP['10'],
              alignItems: 'center',
            }}
          >
            <ActivityIndicator color={C.accent} />
          </View>
        ) : sortedInvites.length === 0 ? (
          <View
            style={{
              paddingVertical: SP['10'],
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
              まだ招待コードはありません
            </Text>
            <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
              「+ 新しい招待コードを作る」を押して発行できます
            </Text>
          </View>
        ) : (
          sortedInvites.map((inv) => (
            <InviteCard
              key={inv.code}
              invite={inv}
              onCopy={() => handleCopy(inv.code)}
              onShare={() => handleShare(inv.code)}
              onRevoke={() => handleRevoke(inv.code)}
              busyRevoke={revokingCode === inv.code}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
