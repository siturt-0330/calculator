import { formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

export function formatRelative(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: ja });
  } catch {
    return '';
  }
}

export function formatDate(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}
