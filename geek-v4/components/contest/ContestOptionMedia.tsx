// =============================================================================
// components/contest/ContestOptionMedia.tsx — 選択肢/作品のメディア表示(画像/動画)
// -----------------------------------------------------------------------------
// 画像は Supabase render endpoint(thumbedUrl・§5.10 の cover 罠回避で contain ソース)+
// expo-image contentFit=cover で枠を埋める。動画は既存 VideoPlayer(native/web 両対応)。
// =============================================================================

import { View } from 'react-native';
import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';

import { R } from '../../design/tokens';
import { thumbedUrl, squareThumbedUrl } from '../../lib/utils/imageUrl';
import { VideoPlayer } from '../ui/VideoPlayer';

export function ContestOptionMedia({ url, type, height = 150, rounded = R.md, size }: { url: string; type: 'image' | 'video' | null; height?: number; rounded?: number; size?: number }) {
  // size 指定 = 正方形サムネ(集計バー等)。動画は再生バッジ、画像は cover サムネ。
  if (size != null) {
    return (
      <View style={{ width: size, height: size, borderRadius: 8, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        {type === 'video'
          ? <Play size={Math.round(size * 0.45)} color="#fff" fill="#fff" />
          : <Image source={{ uri: squareThumbedUrl(url, size * 2) }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} />}
      </View>
    );
  }
  if (type === 'video') {
    return <VideoPlayer uri={url} style={{ borderRadius: rounded }} initialMuted />;
  }
  return (
    <View style={{ width: '100%', height, borderRadius: rounded, overflow: 'hidden', backgroundColor: '#000' }}>
      <Image source={{ uri: thumbedUrl(url, 900) }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} />
    </View>
  );
}
