import { useLanguageStore } from '@/stores/languageStore';
import { t as translate, STRINGS } from '@/lib/i18n/dictionary';

/**
 * 国際化された翻訳フック
 *   const t = useT();
 *   <Text>{t('common.save')}</Text>
 *   <Text>{t('common.minutes_ago', { n: 5 })}</Text>
 */
export function useT() {
  const lang = useLanguageStore((s) => s.lang);
  return (key: keyof typeof STRINGS | string, vars: Record<string, string | number> = {}) =>
    translate(key, lang, vars);
}
