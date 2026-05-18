import { useFonts } from '@expo-google-fonts/syne';
import { Syne_600SemiBold, Syne_700Bold } from '@expo-google-fonts/syne';
import {
  NotoSansJP_400Regular, NotoSansJP_500Medium, NotoSansJP_700Bold,
} from '@expo-google-fonts/noto-sans-jp';
import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_900Black,
} from '@expo-google-fonts/inter';

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Syne_600SemiBold, Syne_700Bold,
    NotoSansJP_400Regular, NotoSansJP_500Medium, NotoSansJP_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_900Black,
  });

  // フォント失敗はシステムフォントにフォールバック（アプリは止めない）
  return loaded || !!error;
}
