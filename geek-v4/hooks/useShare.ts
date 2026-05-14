import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';

export function useShare() {
  const share = async (title: string, url: string) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Share.share({ title, url, message: `${title}\n${url}` });
    } catch {}
  };
  return { share };
}
