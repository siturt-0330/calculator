// ============================================================
// HeroAvatar — gradient ring を持つ「自分の」アバター
// ------------------------------------------------------------
// マイページの hero 部分で使う、グラデーションリングを纏った
// 大きめアバター。既存 Avatar component を中央に置き、外側に
// LinearGradient で 3px のリングを描く。
//
// 影は SHADOW.glow (紫の色付き shadow) でふわっと発光させる。
// ============================================================
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '../ui/Avatar';
import { GRAD, SHADOW, R } from '../../design/tokens';

interface HeroAvatarProps {
  /** アバターの直径 (default 96) */
  size?: number;
  /** プロフィールの avatar_url (Supabase storage の URL) */
  avatarUrl?: string | null;
  /** 絵文字アバターを使うときの emoji */
  avatarEmoji?: string | null;
  /** イニシャル fallback 用の nickname */
  nickname?: string | null;
}

/**
 * 中央のアバターに gradient ring (3px) を被せる。
 *
 * 構造:
 *   <View style={glow + outer container}>
 *     <LinearGradient (GRAD.primary) 全面塗り = ring>
 *       <View ring の内側 (size+inner offset)>
 *         <Avatar size={size} />
 *       </View>
 *     </LinearGradient>
 *   </View>
 *
 * 3px の ring は LinearGradient と 内側 View の差分で作る。
 */
export function HeroAvatar({
  size = 96,
  avatarUrl,
  avatarEmoji,
  nickname,
}: HeroAvatarProps) {
  const ringWidth = 3;
  const outerSize = size + ringWidth * 2;

  return (
    <View
      style={[
        {
          width: outerSize,
          height: outerSize,
          borderRadius: R.full,
        },
        SHADOW.glow,
      ]}
    >
      <LinearGradient
        colors={GRAD.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: outerSize,
          height: outerSize,
          borderRadius: R.full,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Avatar 本体 — Avatar 自身が round + emoji/image fallback を持っている */}
        <Avatar
          size={size}
          uri={avatarUrl ?? undefined}
          emoji={avatarEmoji ?? undefined}
          name={nickname ?? undefined}
        />
      </LinearGradient>
    </View>
  );
}
