import { useFonts as useSyne, Syne_600SemiBold, Syne_700Bold } from '@expo-google-fonts/syne';
import {
  NotoSansJP_400Regular, NotoSansJP_500Medium, NotoSansJP_700Bold,
} from '@expo-google-fonts/noto-sans-jp';
import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import * as Font from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';

export function useAppFonts(): boolean {
  const [googleLoaded, googleError] = useSyne({
    Syne_600SemiBold, Syne_700Bold,
    NotoSansJP_400Regular, NotoSansJP_500Medium, NotoSansJP_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  });

  const [iconsLoaded, setIconsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await Font.loadAsync({ ...Ionicons.font, ...Feather.font });
      } finally {
        setIconsLoaded(true);
      }
    })();
  }, []);

  if (googleError) return iconsLoaded;
  return googleLoaded && iconsLoaded;
}
