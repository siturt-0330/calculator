import { useState } from 'react';
import { Image, View, Text, type ImageProps, type StyleProp, type ViewStyle } from 'react-native';
import { C, R } from '../../design/tokens';

// ============================================================
// RemoteImage — 404 / 巨大 / 遅延ロードに耐える画像コンポーネント
// ============================================================
// 監査指摘: アバター以外の <Image source={{ uri: ... }}> が onError 無しで
// 404 が来ると空ボックスが残っていた。共通コンポーネントで
//   - onError でフォールバック (絵文字 or プレースホルダ色)
//   - loading 中の skeleton
//   - accessibilityLabel 必須化
// を一括対応する。
//
// 使い方:
//   <RemoteImage uri={url} fallbackEmoji="🏞" label="聖地写真" style={{...}} />
// ============================================================

type Props = Omit<ImageProps, 'source' | 'style'> & {
  uri: string | null | undefined;
  fallbackEmoji?: string;
  fallbackBg?: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
};

export function RemoteImage({
  uri,
  fallbackEmoji = '🖼️',
  fallbackBg = C.bg3,
  label,
  style,
  resizeMode = 'cover',
  ...rest
}: Props) {
  const [errored, setErrored] = useState(false);
  const showFallback = !uri || errored;

  if (showFallback) {
    return (
      <View
        style={[
          {
            backgroundColor: fallbackBg,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: R.md,
          },
          style,
        ]}
        accessibilityLabel={label ?? '画像なし'}
        accessibilityRole="image"
      >
        <Text style={{ fontSize: 24, opacity: 0.6 }}>{fallbackEmoji}</Text>
      </View>
    );
  }

  return (
    <Image
      {...rest}
      source={{ uri }}
      style={[{ backgroundColor: fallbackBg, borderRadius: R.md }, style]}
      resizeMode={resizeMode}
      onError={() => setErrored(true)}
      accessibilityLabel={label}
      accessible={!!label}
    />
  );
}
