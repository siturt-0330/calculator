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
//
// UI Polish (Phase 2):
// - 「最も新しい有効な招待」を hero として 1 枚大きく表示:
//     QR code (white bg, SHADOW.md) → GradientCard で code (h1, monospace)
//     → コピー / 共有の PolishedButton 2 つ
// - それより古い / 期限切れ / 使用済み は「招待リンク履歴」セクションに小さく並べる
// - 履歴行は GlassCard で row 表示 (code / status badge / 期限 / 削除)
// ============================================================

import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Platform,
  Share,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Button } from '../../../components/ui/Button';
import { GradientCard } from '../../../components/ui/GradientCard';
import { GlassCard } from '../../../components/ui/GlassCard';
import { PolishedButton } from '../../../components/ui/PolishedButton';
import { Icon } from '../../../constants/icons';
import {
  useMyInvites,
  useCreateInvite,
  useRevokeInvite,
} from '../../../hooks/useFriendInvites';
import { inviteUrlFor } from '../../../lib/api/friends';
import { useToastStore } from '../../../stores/toastStore';
import { C, R, SHADOW, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import type { FriendInvite } from '../../../types/models';

// ============================================================
// status badge の色設定 (hero / history 行で共有)
// ============================================================
type InviteStatus = 'active' | 'expired' | 'used';

function statusOf(invite: FriendInvite): InviteStatus {
  if (invite.used_by) return 'used';
  if (new Date(invite.expires_at).getTime() < Date.now()) return 'expired';
  return 'active';
}

function statusBadge(status: InviteStatus): {
  label: string;
  bg: string;
  fg: string;
} {
  switch (status) {
    case 'used':
      // 使用済 = 青 (お祝い系の落ち着いた色)
      return { label: '使用済み', bg: C.blueBg, fg: C.blue };
    case 'expired':
      // 期限切れ = 灰
      return { label: '期限切れ', bg: C.bg3, fg: C.text3 };
    case 'active':
      // 有効 = 緑
      return { label: '有効', bg: C.greenBg, fg: C.green };
  }
}

// 「あと約3日」/「3日前に期限切れ」を返す。失敗時は空文字。
function formatExpiry(iso: string): { isExpired: boolean; label: string } {
  const d = new Date(iso);
  const expired = d.getTime() < Date.now();
  try {
    const distance = formatDistanceToNow(d, { locale: ja });
    return {
      isExpired: expired,
      label: expired ? `${distance}前に期限切れ` : `あと約${distance}`,
    };
  } catch {
    return { isExpired: expired, label: '' };
  }
}

// ============================================================
// Hero card — 最新の有効な招待を大きく表示
// ============================================================
function InviteHero({
  invite,
  qrSize,
  onCopy,
  onShare,
}: {
  invite: FriendInvite;
  qrSize: number;
  onCopy: () => void;
  onShare: () => void;
}) {
  const url = inviteUrlFor(invite.code);
  const { label: expiryLabel } = useMemo(
    () => formatExpiry(invite.expires_at),
    [invite.expires_at],
  );

  return (
    <View style={{ gap: SP['4'] }}>
      {/* QR code card — white bg + SHADOW.md, 画面幅の 70% くらいに center */}
      <View
        style={{
          alignSelf: 'center',
          backgroundColor: '#fff',
          padding: SP['5'],
          borderRadius: R.lg,
          alignItems: 'center',
          gap: SP['2'],
          ...SHADOW.md,
        }}
      >
        <QRCode
          value={url}
          size={qrSize}
          color="#000"
          backgroundColor="#fff"
        />
      </View>
      <Text
        style={[
          T.caption,
          { color: C.text2, textAlign: 'center', marginTop: -SP['1'] },
        ]}
      >
        QR を友達に見せる
      </Text>

      {/* code hero card — グラデ背景の上に大きい monospace code */}
      <PressableScale onPress={onCopy} haptic="confirm">
        <GradientCard gradient="primary" glow style={{ padding: SP['5'] }}>
          <View style={{ alignItems: 'center', gap: SP['2'] }}>
            <Text
              style={{
                color: '#fff',
                fontSize: 32,
                fontWeight: '800',
                letterSpacing: 3,
                textAlign: 'center',
                fontFamily:
                  Platform.OS === 'web' ? 'Inter, monospace' : undefined,
              }}
              selectable
              numberOfLines={1}
            >
              {invite.code}
            </Text>
            <Text
              style={{
                color: 'rgba(255,255,255,0.7)',
                fontSize: 12,
                letterSpacing: 0.5,
              }}
            >
              タップでコピー
            </Text>
            {expiryLabel ? (
              <View
                style={{
                  marginTop: SP['1'],
                  paddingHorizontal: SP['3'],
                  paddingVertical: 2,
                  borderRadius: R.full,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                }}
              >
                <Text
                  style={{
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: '600',
                  }}
                >
                  {expiryLabel}
                </Text>
              </View>
            ) : null}
          </View>
        </GradientCard>
      </PressableScale>

      {/* action buttons */}
      <View style={{ flexDirection: 'row', gap: SP['2'] }}>
        <View style={{ flex: 1 }}>
          <PolishedButton
            variant="solid"
            label="コピー"
            icon={<Icon.copy size={16} color="#fff" strokeWidth={2.2} />}
            onPress={onCopy}
            fullWidth
            haptic="confirm"
          />
        </View>
        <View style={{ flex: 1 }}>
          <PolishedButton
            variant="gradient"
            gradient="primary"
            label="共有"
            icon={<Icon.share size={16} color="#fff" strokeWidth={2.2} />}
            onPress={onShare}
            fullWidth
            haptic="confirm"
          />
        </View>
      </View>
    </View>
  );
}

// ============================================================
// 招待リンク履歴の 1 行 (古い / 期限切れ / 使用済み)
// ============================================================
function InviteHistoryRow({
  invite,
  onRevoke,
  busyRevoke,
}: {
  invite: FriendInvite;
  onRevoke: () => void;
  busyRevoke: boolean;
}) {
  const status = statusOf(invite);
  const badge = statusBadge(status);
  const expiry = useMemo(
    () => formatExpiry(invite.expires_at),
    [invite.expires_at],
  );

  return (
    <GlassCard style={{ padding: SP['3'], ...SHADOW.xs }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
        }}
      >
        {/* code (monospace, 中央寄せに見える左寄せ) */}
        <Text
          style={[
            T.mono,
            {
              color: C.text,
              fontSize: 14,
              letterSpacing: 1,
              flex: 1,
            },
          ]}
          numberOfLines={1}
          selectable
        >
          {invite.code}
        </Text>
        {/* status badge */}
        <View
          style={{
            paddingHorizontal: SP['2'],
            paddingVertical: 2,
            backgroundColor: badge.bg,
            borderRadius: R.sm,
          }}
        >
          <Text style={[T.caption, { color: badge.fg, fontWeight: '700' }]}>
            {badge.label}
          </Text>
        </View>
        {/* 削除 X icon */}
        <PressableScale
          onPress={onRevoke}
          haptic="warn"
          disabled={busyRevoke}
          accessibilityLabel="この招待を削除"
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: 'rgba(226,75,74,0.10)',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: busyRevoke ? 0.5 : 1,
          }}
        >
          {busyRevoke ? (
            <ActivityIndicator size="small" color={C.red} />
          ) : (
            <Icon.close size={14} color={C.red} strokeWidth={2.4} />
          )}
        </PressableScale>
      </View>
      {expiry.label ? (
        <Text
          style={[T.caption, { color: C.text3, marginTop: 4 }]}
          numberOfLines={1}
        >
          {expiry.label}
        </Text>
      ) : null}
    </GlassCard>
  );
}

// ============================================================
// メイン screen
// ============================================================
export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const show = useToastStore((s) => s.show);
  const { width } = useWindowDimensions();
  const { invites, isLoading } = useMyInvites();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();

  // QR の大きさ: 画面幅の 70% を目安に、200-260 の範囲で clamp
  // (大きすぎると hero 全体がページから溢れて見える)
  const qrSize = Math.max(180, Math.min(240, Math.floor(width * 0.7) - SP['10']));

  // 有効 (= 未使用 + 期限内) を先頭、それ以外を後ろ。同じグループ内では新しい順。
  // hook 側で created_at desc は既に取れているので、ここでは valid フラグで安定 sort。
  const sortedInvites = useMemo(() => {
    return [...invites].sort((a, b) => {
      const va = statusOf(a) === 'active' ? 0 : 1;
      const vb = statusOf(b) === 'active' ? 0 : 1;
      if (va !== vb) return va - vb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [invites]);

  // hero として 1 枚 (最新の有効な招待). 残りは履歴セクションに出す.
  const heroInvite = sortedInvites.find((inv) => statusOf(inv) === 'active');
  const historyInvites = useMemo(
    () => sortedInvites.filter((inv) => inv !== heroInvite),
    [sortedInvites, heroInvite],
  );

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
  const handleShare = async (code: string) => {
    const url = inviteUrlFor(code);
    const message = `GEEK で友達になろう！\n${url}`;

    if (Platform.OS === 'web') {
      const nav =
        typeof navigator !== 'undefined'
          ? (navigator as Navigator & {
              share?: (data: ShareData) => Promise<void>;
            })
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
          const err = e as { name?: string };
          if (err?.name === 'AbortError') return;
        }
      }
      try {
        await Clipboard.setStringAsync(url);
        show('リンクをコピーしました', 'success');
      } catch {
        show('共有に失敗しました', 'error');
      }
      return;
    }

    try {
      await Share.share({ message, url, title: 'GEEK 友達招待' });
    } catch (e) {
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
        const msg =
          e instanceof Error ? e.message : '招待コードの作成に失敗しました';
        show(msg, 'error');
      },
    });
  };

  // ============================================================
  // 削除
  // ============================================================
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
        <GlassCard
          style={{
            padding: SP['4'],
            flexDirection: 'row',
            gap: SP['3'],
            alignItems: 'flex-start',
          }}
        >
          <Icon.friends size={22} color={C.accent} strokeWidth={2} />
          <Text style={[T.small, { color: C.text2, flex: 1, lineHeight: 20 }]}>
            招待リンクを送って友達に登録してもらおう。リンクは 7 日間有効です。
          </Text>
        </GlassCard>

        {isLoading ? (
          <View
            style={{
              paddingVertical: SP['10'],
              alignItems: 'center',
            }}
          >
            <ActivityIndicator color={C.accent} />
          </View>
        ) : (
          <>
            {/* Hero: 有効な招待が 1 つでもあれば QR + code を大きく */}
            {heroInvite ? (
              <InviteHero
                invite={heroInvite}
                qrSize={qrSize}
                onCopy={() => handleCopy(heroInvite.code)}
                onShare={() => handleShare(heroInvite.code)}
              />
            ) : (
              <GlassCard
                style={{
                  padding: SP['6'],
                  alignItems: 'center',
                  gap: SP['2'],
                }}
              >
                <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
                  有効な招待コードがありません
                </Text>
                <Text
                  style={[T.caption, { color: C.text3, textAlign: 'center' }]}
                >
                  下のボタンで新しいコードを発行できます
                </Text>
              </GlassCard>
            )}

            {/* 新規発行 button (常に表示) */}
            <Button
              label={create.isPending ? '作成中…' : '+ 新しい招待コードを作る'}
              onPress={handleCreate}
              variant="primary"
              size="md"
              fullWidth
              loading={create.isPending}
              haptic="confirm"
            />

            {/* 招待リンク履歴 */}
            {historyInvites.length > 0 ? (
              <View style={{ gap: SP['2'] }}>
                <Text
                  style={[
                    T.smallB,
                    {
                      color: C.text2,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                      marginTop: SP['2'],
                    },
                  ]}
                >
                  招待リンク履歴
                </Text>
                {historyInvites.map((inv) => (
                  <InviteHistoryRow
                    key={inv.code}
                    invite={inv}
                    onRevoke={() => handleRevoke(inv.code)}
                    busyRevoke={revokingCode === inv.code}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
