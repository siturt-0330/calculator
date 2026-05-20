import { View, Text, Linking, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchAndCachePreview } from '../../lib/api/linkPreview';
import { PressableScale } from '../ui/PressableScale';
import { ProgressiveImage } from '../ui/ProgressiveImage';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

function shortHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function LinkPreviewCard({ url }: { url: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['link-preview', url],
    queryFn: () => fetchAndCachePreview(url),
    enabled: !!url,
    staleTime: 60 * 60 * 1000,  // 1h
  });

  const open = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  // ローディング/失敗時はシンプルな出典バー
  if (isLoading || !data || (!data.title && !data.image_url)) {
    return (
      <PressableScale onPress={open} haptic="tap" style={{
        marginHorizontal: SP['4'], marginTop: SP['2'],
        paddingHorizontal: SP['3'], paddingVertical: SP['2'],
        backgroundColor: C.bg3, borderRadius: R.md,
        borderWidth: 1, borderColor: C.border,
        flexDirection: 'row', alignItems: 'center', gap: SP['2'],
      }}>
        <Text style={{ fontSize: 14 }}>🔗</Text>
        <Text style={[T.caption, { color: C.text2, flex: 1 }]} numberOfLines={1}>
          出典: {shortHost(url)}
        </Text>
      </PressableScale>
    );
  }

  return (
    <PressableScale onPress={open} haptic="tap" style={{
      marginHorizontal: SP['4'], marginTop: SP['2'],
      backgroundColor: C.bg3,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
    }}>
      {data.image_url && (
        <ProgressiveImage uri={data.image_url} width={'100%' as unknown as number} height={140} radius={0} lazy />
      )}
      <View style={{ padding: SP['3'], gap: 2 }}>
        {data.site_name && (
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {data.site_name}
          </Text>
        )}
        {data.title && (
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]} numberOfLines={2}>
            {data.title}
          </Text>
        )}
        {data.description && (
          <Text style={[T.caption, { color: C.text2, marginTop: 2 }]} numberOfLines={2}>
            {data.description}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <Text style={{ fontSize: 11 }}>🔗</Text>
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {shortHost(url)}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}
