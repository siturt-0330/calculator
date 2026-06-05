// =============================================================================
// ProfileMastheadV2 — マイページ「Atelier 改」誌面マストヘッド
// -----------------------------------------------------------------------------
// 旧 ProfileMasthead を誌面(エディトリアル)に書き直したもの。
//   ・5アイコン pill 群 / @handle 行は撤去 → 右上「設定」1点のみに最小化
//   ・カバーは scrollY 連動の半速 parallax + pull-down over-scale(web は控えめ)
//   ・カバー下端左に「誌名ロックアップ」(MY ATELIER + nickname 白ロゴ)
//   ・名前帯側に HeroAvatar(紫 glow=画面唯一の発光点)を -55 半被せ
//   ・standfirst(固定リード文)を1本だけ置き、余白で「静かな高級感」を出す
//
// レイヤ構成(奥→手前):
//   L0 カバー画像/グラデ fallback(Animated: translateY=scrollY*0.5 / scale / opacity)
//   L1 GRAD.glass の微光(全面・上質感)
//   L2 下端 scrim(常時固定=可読性担保。parallax には連動させない)
//   L3 誌名ロックアップ(Animated: スクロールで消えミニバーへ受け渡し)
//   L4 アバター(Animated: collapse scale + translateY)+ 編集鉛筆バッジ
//   L5 standfirst(固定リード文)
//   右上 設定ピル(Animated: scrollY>120 でフェードアウト→ミニバーへ引き継ぎ)
//
// モーション規律(motionSpec/risks 準拠):
//   ・全 collapse は親から渡される scrollY:SharedValue 1本を useAnimatedStyle で購読。
//   ・worklet 内では C(テーマ色)を参照しない → 色は render 時に解決した
//     数値/文字列のみを style に渡す(ライト/ダークは C 直参照の非 worklet 側で追従)。
//   ・useReducedMotion()===true のときは parallax/scale/translate を全停止し
//     opacity フェードのみ残す(カバー溶け・誌名受け渡し・ピル退場は opacity 経路で
//     意味が壊れない設計)。
//   ・カバー over-scale は web で 1.06 上限(decode 後の再ラスタライズ jank 回避)、
//     native は 1.18。translateY parallax は transform のみ(bg-position は使わない)。
//
// presentational に徹する(fetch/store なし。scrollY と callbacks は親が供給)。
// =============================================================================

import { View, Text, Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { Pencil } from 'lucide-react-native';

import { HeroAvatar } from './HeroAvatar';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, GRAD, R, SP } from '../../design/tokens';
import { T, LOGO_FONT } from '../../design/typography';

// =============================================================================
// 実高(統合担当が List の contentContainerStyle.paddingTop に使う)
//   カバー 240 + 名前帯 132 = 372px。
// =============================================================================
export const HERO_H = 372;
const COVER_H = 240;

// web は decode 後の再ラスタライズが重いので pull-down over-scale を抑える。
const NATIVE = Platform.OS !== 'web';
const COVER_OVERSCALE = NATIVE ? 1.18 : 1.06;

export type ProfileMastheadV2Props = {
  /** 誌名(カバー白ロゴ)に出す表示名。名前帯側には二重表示しない。 */
  nickname: string;
  /** プロフィール avatar_url(Supabase storage)。 */
  avatarUrl?: string | null;
  /** 絵文字アバター。画像が無いときの HeroAvatar fallback + カバー fallback 巨大シルエットに使う。 */
  avatarEmoji?: string | null;
  /** カバー画像 URL(親で thumbedUrl 済)。null なら accent グラデ + emoji シルエット。 */
  coverUri: string | null;
  /** SafeArea top inset(右上設定ピルを status bar の下に置くため)。 */
  topInset: number;
  /** マイページ単一 FlashList の縦スクロール量。全 collapse の駆動源。 */
  scrollY: SharedValue<number>;
  /** アバター右下の鉛筆バッジ。唯一の編集入口(→ /settings/profile-edit 等)。 */
  onEditAvatar: () => void;
  /** 右上の設定ピル(→ /settings)。 */
  onOpenSettings: () => void;
};

export function ProfileMastheadV2(props: ProfileMastheadV2Props) {
  const {
    nickname,
    avatarUrl,
    avatarEmoji,
    coverUri,
    topInset,
    scrollY,
    onEditAvatar,
    onOpenSettings,
  } = props;

  // reanimated 版 useReducedMotion(worklet からも安全に読める)。
  const reduced = useReducedMotion();

  // ---- L0 カバー parallax(translateY 半速 + pull-down over-scale)----
  const coverAnimStyle = useAnimatedStyle(() => {
    if (reduced) {
      // reduce motion: 動かさない(opacity 溶けは別 style が担う)。
      return { transform: [] };
    }
    const translateY = scrollY.value * 0.5; // 半速 parallax(下方向に遅れて流れる)
    const scale = interpolate(
      scrollY.value,
      [-140, 0],
      [COVER_OVERSCALE, 1.0],
      // pull-down(負側)は extend で伸ばし続け、スクロールアップ(正側)は clamp。
      { extrapolateLeft: Extrapolation.EXTEND, extrapolateRight: Extrapolation.CLAMP },
    );
    return { transform: [{ translateY }, { scale }] };
  });

  // ---- L0 カバー opacity(消さず bg へ溶かす。reduce 時もこの経路は残す)----
  const coverFadeStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, 210], [1, 0.32], Extrapolation.CLAMP);
    return { opacity };
  });

  // ---- L3 誌名ロックアップ(スクロールで消えミニバーへ受け渡し)----
  const nameLockupStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [-30, 0, 150], [0, 1, 0], Extrapolation.CLAMP);
    if (reduced) {
      return { opacity, transform: [] };
    }
    const scale = interpolate(scrollY.value, [-30, 0, 150], [1.08, 1, 0.96], Extrapolation.CLAMP);
    return { opacity, transform: [{ scale }] };
  });

  // ---- L4 アバター collapse(scale 縮み + 上へ寄せ)----
  const avatarStyle = useAnimatedStyle(() => {
    if (reduced) {
      return { transform: [] };
    }
    const scale = interpolate(scrollY.value, [0, 160], [1, 0.82], Extrapolation.CLAMP);
    const translateY = interpolate(scrollY.value, [0, 160], [0, -6], Extrapolation.CLAMP);
    return { transform: [{ translateY }, { scale }] };
  });

  // ---- 右上 設定ピル(ミニバー出現に合わせてフェードアウト)----
  const settingsPillStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [120, 180], [1, 0], Extrapolation.CLAMP);
    return { opacity };
  });

  return (
    <View style={{ height: HERO_H, backgroundColor: C.bg }}>
      {/* ===================================================================== */}
      {/* L0 カバー(absolute top0 h240)— Animated 層で parallax + over-scale */}
      {/* ===================================================================== */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: COVER_H,
          overflow: 'hidden',
          backgroundColor: C.bg3, // 初回レイアウトでカバー裏が透けないよう下地を敷く
        }}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: COVER_H,
              // ★ web: アニメ層を GPU レイヤへ昇格し、毎フレームの paint/再合成を断つ。
              ...(Platform.OS === 'web' ? ({ willChange: 'transform, opacity' } as object) : null),
            },
            coverAnimStyle,
            coverFadeStyle,
          ]}
        >
          {coverUri ? (
            <ExpoImage
              source={{ uri: coverUri }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              transition={220}
              cachePolicy="memory-disk"
              recyclingKey={coverUri}
            />
          ) : (
            // fallback: accent グラデ + 巨大 emoji シルエット
            <LinearGradient
              colors={[C.accentDeep, C.accent, C.accentLight]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
            >
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ fontSize: 120, opacity: 0.16 }}
              >
                {avatarEmoji ?? '👤'}
              </Text>
            </LinearGradient>
          )}
        </Animated.View>

        {/* L1 カバー微光(GRAD.glass)— 焼付けはせず scrim 重ねのみ(web 安全) */}
        <LinearGradient
          colors={GRAD.glass}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.6 }}
          pointerEvents="none"
        />

        {/* L2 下端 scrim — parallax に連動させず常に固定(誌名の可読性を担保) */}
        <LinearGradient
          colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.55)', C.bg]}
          locations={[0.4, 0.85, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          pointerEvents="none"
        />

        {/* L3 誌名ロックアップ(カバー左下寄り)。
            ★ アバターが -55 で半被せするため、誌名は bottom:72 に持ち上げて
              アバターの上に逃がす(誌名がアバターに隠れて読めない不具合の解消)。 */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: SP['4'],
              right: SP['4'],
              bottom: 72,
              ...(Platform.OS === 'web' ? ({ willChange: 'transform, opacity' } as object) : null),
            },
            nameLockupStyle,
          ]}
        >
          <Text
            style={{
              fontSize: 10,
              letterSpacing: 3,
              color: 'rgba(255,255,255,0.72)',
              textShadowColor: 'rgba(0,0,0,0.5)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 3,
            }}
          >
            MY ATELIER
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: LOGO_FONT,
              fontWeight: '700',
              fontSize: 34,
              lineHeight: 38,
              letterSpacing: -0.6,
              color: '#fff',
              textShadowColor: 'rgba(0,0,0,0.55)',
              textShadowOffset: { width: 0, height: 2 },
              textShadowRadius: 8,
            }}
          >
            {nickname}
          </Text>
        </Animated.View>
      </View>

      {/* ===================================================================== */}
      {/* L4 アバター(名前帯側・カバー下端に -55 半被せ) */}
      {/* ===================================================================== */}
      <Animated.View
        style={[
          {
            marginTop: COVER_H - 55,
            paddingHorizontal: SP['4'],
            alignSelf: 'flex-start',
            // ★ web: scale する層をレイヤ昇格し、子の glow(box-shadow)の毎フレーム
            //   再ラスタライズを止める。
            ...(Platform.OS === 'web' ? ({ willChange: 'transform' } as object) : null),
          },
          avatarStyle,
        ]}
      >
        <View
          style={{
            borderRadius: 60,
            backgroundColor: C.bg, // 台座=カバーとアバターの間の「白フチ」
            padding: 4,
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
          {/* 編集鉛筆バッジ(唯一の編集入口)。34→hitSlop8 で実質 44 タップ。 */}
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
        </View>
      </Animated.View>

      {/* ===================================================================== */}
      {/* L5 standfirst(固定リード文)— 右に 120 の溝でアバ半被せ分を空ける */}
      {/* ===================================================================== */}
      <Text
        numberOfLines={2}
        style={[
          T.body,
          {
            color: C.text2,
            marginTop: SP['3'],
            paddingLeft: SP['4'],
            paddingRight: 120,
          },
        ]}
      >
        “好き”を匿名で、安心して続ける。あなたの記録。
      </Text>

      {/* ===================================================================== */}
      {/* 右上 設定ピル(カバー右上・絶対配置)— ミニバー出現でフェードアウト */}
      {/* ===================================================================== */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            top: topInset + SP['3'],
            right: SP['4'],
            ...(Platform.OS === 'web' ? ({ willChange: 'opacity' } as object) : null),
          },
          settingsPillStyle,
        ]}
      >
        <PressableScale
          onPress={onOpenSettings}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel="設定を開く"
          style={{
            width: 36,
            height: 36,
            borderRadius: R.full,
            alignItems: 'center',
            justifyContent: 'center',
            // ★ backdrop-filter を撤去。退場 opacity アニメ中の要素に blur が同居すると
            //   毎フレーム背景 blur を再計算して重い。半透明黒の塗りだけで可読性は十分。
            backgroundColor: 'rgba(0,0,0,0.45)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.14)',
          }}
        >
          <Icon.settings size={18} color="#fff" strokeWidth={2.2} />
        </PressableScale>
      </Animated.View>
    </View>
  );
}
