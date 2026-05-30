// =============================================================================
// ProfileMasthead — マイページのヘッダー (カバー + 大型アバター + 名前のみ)
// -----------------------------------------------------------------------------
// 構成 (縦):
//   1) カバー画像 (高さ 220) — coverUri があればそれ、無ければ accent gradient
//      + ユーザー名 emoji を巨大シルエットで表示
//   2) カバー下半分に dark gradient overlay
//   3) 上端ピル群 (戻る + 追加 / 検索 / 共有 / もっと)
//   4) 左下に半分被せる円形アバター (110px / accent ring)
//   5) 名前 + handle のみ (bio / 統計chip / フォローボタンは仕様により削除)
//
// presentational に徹する (fetch/store なし)。
// =============================================================================

import { View, Text, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import {
  Share2,
  MoreHorizontal,
  ArrowLeft,
  Plus,
  Search as SearchIcon,
  Camera,
  Pencil,
} from 'lucide-react-native';

import { HeroAvatar } from './HeroAvatar';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';

export type ProfileMastheadProps = {
  nickname: string;
  handle: string; // 例: '@taro'
  avatarUrl: string | null | undefined;
  avatarEmoji: string | null | undefined;
  /** カバー画像 URL。無ければ accent gradient + シルエットになる。 */
  coverUri: string | null;
  /** SafeArea top inset (アクションpillをstatus barの下に配置するため) */
  topInset: number;
  onSharePress: () => void;
  onMorePress: () => void;
  onAddPress: () => void; // 投稿/写真追加
  onSearchPress: () => void;
  onBackPress?: () => void; // 任意 (PC 3 カラムでは不要)
  /** 本人視点のときだけ渡す: カバー編集ボタン (右下のカメラ pill) */
  onEditCover?: () => void;
  /** 本人視点のときだけ渡す: アバター編集ボタン (アバター右下の鉛筆バッジ) */
  onEditAvatar?: () => void;
};

export function ProfileMasthead(props: ProfileMastheadProps) {
  const {
    nickname,
    handle,
    avatarUrl,
    avatarEmoji,
    coverUri,
    topInset,
    onSharePress,
    onMorePress,
    onAddPress,
    onSearchPress,
    onBackPress,
    onEditCover,
    onEditAvatar,
  } = props;

  return (
    <View style={{ backgroundColor: C.bg }}>
      {/* ===== カバー (高さ 220) ===== */}
      <View style={{ height: 220, width: '100%', overflow: 'hidden' }}>
        {coverUri ? (
          <ExpoImage
            source={{ uri: coverUri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={220}
            cachePolicy="memory-disk"
          />
        ) : (
          // Fallback: accent gradient + 大きな emoji シルエット
          <LinearGradient
            colors={[C.accentDeep, C.accent, C.accentLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 96, opacity: 0.18 }}>{avatarEmoji ?? '👤'}</Text>
          </LinearGradient>
        )}
        {/* 下端の dark gradient (文字を読みやすく) */}
        <LinearGradient
          colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.55)', C.bg]}
          locations={[0.4, 0.85, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          pointerEvents="none"
        />

        {/* カバー編集 pill (本人視点のみ・右下に半透明の「カメラ」ボタン) */}
        {onEditCover ? (
          <PressableScale
            onPress={onEditCover}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel="カバー画像を変更"
            style={{
              position: 'absolute',
              right: SP['4'],
              bottom: SP['4'],
              paddingHorizontal: SP['3'],
              paddingVertical: 6,
              borderRadius: R.full,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: 'rgba(0,0,0,0.55)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.18)',
              ...(Platform.OS === 'web'
                ? ({ backdropFilter: 'blur(8px)' } as object)
                : null),
            }}
          >
            <Camera size={14} color="#fff" strokeWidth={2.2} />
            <Text style={[T.smallB, { color: '#fff', fontSize: 12 }]}>
              カバーを変更
            </Text>
          </PressableScale>
        ) : null}

        {/* ===== 上端ピル群 (戻る + 追加 + 検索 + 共有 + もっと) ===== */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: topInset + SP['3'],
            paddingHorizontal: SP['4'],
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: SP['2'],
          }}
        >
          {/* 左: 戻る (任意) */}
          {onBackPress ? (
            <TopPillButton onPress={onBackPress} accessibilityLabel="戻る">
              <ArrowLeft size={18} color="#fff" strokeWidth={2.4} />
            </TopPillButton>
          ) : (
            <View style={{ width: 40 }} />
          )}
          {/* 右: 4 アイコン pill */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.45)',
              borderRadius: R.full,
              paddingHorizontal: SP['1'],
              paddingVertical: 4,
              gap: 4,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.12)',
              ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(8px)' } as object) : null),
            }}
          >
            <PillIcon onPress={onAddPress} accessibilityLabel="新規追加">
              <Plus size={18} color="#fff" strokeWidth={2.4} />
            </PillIcon>
            <PillIcon onPress={onSearchPress} accessibilityLabel="検索">
              <SearchIcon size={18} color="#fff" strokeWidth={2.4} />
            </PillIcon>
            <PillIcon onPress={onSharePress} accessibilityLabel="共有">
              <Share2 size={18} color="#fff" strokeWidth={2.4} />
            </PillIcon>
            <PillIcon onPress={onMorePress} accessibilityLabel="もっと">
              <MoreHorizontal size={20} color="#fff" strokeWidth={2.4} />
            </PillIcon>
          </View>
        </View>
      </View>

      {/* ===== アバター + 名前 (bio/統計/フォローボタンは仕様により削除) ===== */}
      <View style={{ paddingHorizontal: SP['4'], marginTop: -55 }}>
        {/* アバター (110px / accent ring) + 編集バッジ (本人視点のみ) */}
        <View
          style={{
            borderRadius: 60,
            backgroundColor: C.bg,
            padding: 4, // ring 用の隙間
            alignSelf: 'flex-start',
            position: 'relative',
          }}
        >
          <HeroAvatar
            size={110}
            avatarUrl={avatarUrl}
            avatarEmoji={avatarEmoji}
            nickname={nickname}
          />
          {onEditAvatar ? (
            <PressableScale
              onPress={onEditAvatar}
              haptic="tap"
              accessibilityRole="button"
              accessibilityLabel="プロフィール画像を変更"
              style={{
                position: 'absolute',
                right: 2,
                bottom: 2,
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: C.accent,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: C.bg,
              }}
            >
              <Pencil size={14} color="#fff" strokeWidth={2.4} />
            </PressableScale>
          ) : null}
        </View>

        {/* 名前 + handle */}
        <View style={{ marginTop: SP['3'] }}>
          <Text
            style={{
              fontFamily: LOGO_FONT,
              fontWeight: LOGO_FONT_WEIGHT,
              fontSize: 24,
              lineHeight: 28,
              letterSpacing: -0.6,
              color: C.text,
            }}
            numberOfLines={1}
          >
            {nickname}
          </Text>
          <Text style={[T.small, { color: C.text3, marginTop: 2 }]} numberOfLines={1}>
            {handle}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ----- 内部の小部品 -----
function TopPillButton({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(8px)' } as object) : null),
      }}
    >
      {children}
    </PressableScale>
  );
}

function PillIcon({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </PressableScale>
  );
}
