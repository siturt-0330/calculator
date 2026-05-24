import { create } from 'zustand';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getBool,
  setBool,
  getString,
  setString,
  getNumber,
  setNumber,
  contains as storageContains,
} from '../lib/storage';

// ============================================================
// Settings (永続化される全ユーザー設定)
// ============================================================
// language → 表示言語 (i18n)
// notify* → 通知種別ごとの ON/OFF
// pushEnabled → プッシュ通知全体マスタースイッチ
// quietStart/quietEnd → 「おやすみ時間」(時のみ, 0-23)。null は無効
// reduceMotion → アニメーション抑制
// dataSaver → 画像 LQIP のみ表示, 自動再生停止
// concernsPrivate → 「気になる」をこっそりモード
// ============================================================
//
// パフォーマンス改修:
//   旧版は 1 つの JSON BLOB を AsyncStorage に保存していて、cold start
//   の hydrate で bridge round-trip + JSON.parse が必要だった (~50ms)。
//   MMKV ベースの個別キー保存に書き換え、hydrate は同期で 1ms 以下。
// ============================================================

type Settings = {
  language: 'ja' | 'en' | 'ko' | 'zh' | 'th' | 'fr' | 'es';
  pushEnabled: boolean;
  notifyLike: boolean;
  notifyComment: boolean;
  notifyFollow: boolean;
  notifyEvent: boolean;
  notifyReply: boolean;
  notifyMention: boolean;
  notifyTagNew: boolean;       // 好きタグの新着
  notifyAnnouncement: boolean; // 運営からのお知らせ
  quietStartHour: number | null;  // 0-23
  quietEndHour: number | null;    // 0-23
  reduceMotion: boolean;
  dataSaver: boolean;
  concernsPrivate: boolean;
  autoApplyTagClusters: boolean;  // 高信頼タグクラスタを自動グループ化
};

const DEFAULTS: Settings = {
  language: 'ja',
  pushEnabled: true,
  notifyLike: true,
  notifyComment: true,
  notifyFollow: true,
  notifyEvent: true,
  notifyReply: true,
  notifyMention: true,
  notifyTagNew: true,
  notifyAnnouncement: true,
  quietStartHour: null,
  quietEndHour: null,
  reduceMotion: false,
  dataSaver: false,
  concernsPrivate: true,
  autoApplyTagClusters: false,  // opt-in (ユーザーが明示 ON にしないと自動 accept しない)
};

// 旧 AsyncStorage キー (JSON BLOB) — migrate 時に読む
const LEGACY_KEY = 'geek:settings';
// 新 MMKV キー prefix — 各フィールドを個別に保存
const KEY_PREFIX = 'geek:settings:';
// sentinel: 旧 AsyncStorage からの初回 migrate が済んだかどうか
const MIGRATED_FLAG = 'geek:settings:_migrated_v1';

type SettingsState = Settings & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

// ============================================================
// validators
// ============================================================
const LANG_VALID: Settings['language'][] = ['ja', 'en', 'ko', 'zh', 'th', 'fr', 'es'];
function isValidLang(v: unknown): v is Settings['language'] {
  return typeof v === 'string' && (LANG_VALID as string[]).includes(v);
}
function isValidHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
}

// 永続化された設定の形 (バージョン違い / 壊れたデータ) を実行時バリデート。
// 余計なキーは捨てて、型が違う値は DEFAULTS で上書きする。これで誤った
// 設定値による画面クラッシュを防ぐ。
function sanitizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  const pickBool = (k: keyof Settings): boolean =>
    typeof r[k] === 'boolean' ? (r[k] as boolean) : (DEFAULTS[k] as boolean);
  const pickLang = (): Settings['language'] => (isValidLang(r.language) ? r.language : DEFAULTS.language);
  const pickHour = (k: 'quietStartHour' | 'quietEndHour'): number | null => {
    const v = r[k];
    if (v === null) return null;
    if (isValidHour(v)) return v;
    return null;
  };
  return {
    language: pickLang(),
    pushEnabled: pickBool('pushEnabled'),
    notifyLike: pickBool('notifyLike'),
    notifyComment: pickBool('notifyComment'),
    notifyFollow: pickBool('notifyFollow'),
    notifyEvent: pickBool('notifyEvent'),
    notifyReply: pickBool('notifyReply'),
    notifyMention: pickBool('notifyMention'),
    notifyTagNew: pickBool('notifyTagNew'),
    notifyAnnouncement: pickBool('notifyAnnouncement'),
    quietStartHour: pickHour('quietStartHour'),
    quietEndHour: pickHour('quietEndHour'),
    reduceMotion: pickBool('reduceMotion'),
    dataSaver: pickBool('dataSaver'),
    concernsPrivate: pickBool('concernsPrivate'),
    autoApplyTagClusters: pickBool('autoApplyTagClusters'),
  };
}

// ============================================================
// MMKV ↔ Settings 変換
// ============================================================

// 個別キーで保存 — quietStartHour / quietEndHour は null をマーカー文字列で表現
// (MMKV の null/undefined は区別できないので明示的に保存する)
function loadSettingsSync(): Settings {
  // 完全に値が無ければ DEFAULTS (新規ユーザー)
  // 何か 1 つでもあれば部分復元 (deletion 経由で消えた key は DEFAULTS で埋める)
  const has = (k: keyof Settings): boolean => storageContains(KEY_PREFIX + k);
  const pickBool = (k: keyof Settings): boolean => {
    if (!has(k)) return DEFAULTS[k] as boolean;
    const v = getBool(KEY_PREFIX + k);
    return v === undefined ? (DEFAULTS[k] as boolean) : v;
  };
  const pickLang = (): Settings['language'] => {
    const v = getString(KEY_PREFIX + 'language');
    return isValidLang(v) ? v : DEFAULTS.language;
  };
  const pickHour = (k: 'quietStartHour' | 'quietEndHour'): number | null => {
    // 'null' 文字列マーカーで明示的に null を表現する。
    // (MMKV は number と string を別 namespace で保存するため両方確認)
    const marker = getString(KEY_PREFIX + k);
    if (marker === 'null') return null;
    const v = getNumber(KEY_PREFIX + k);
    return isValidHour(v) ? v : null;
  };
  return {
    language: pickLang(),
    pushEnabled: pickBool('pushEnabled'),
    notifyLike: pickBool('notifyLike'),
    notifyComment: pickBool('notifyComment'),
    notifyFollow: pickBool('notifyFollow'),
    notifyEvent: pickBool('notifyEvent'),
    notifyReply: pickBool('notifyReply'),
    notifyMention: pickBool('notifyMention'),
    notifyTagNew: pickBool('notifyTagNew'),
    notifyAnnouncement: pickBool('notifyAnnouncement'),
    quietStartHour: pickHour('quietStartHour'),
    quietEndHour: pickHour('quietEndHour'),
    reduceMotion: pickBool('reduceMotion'),
    dataSaver: pickBool('dataSaver'),
    concernsPrivate: pickBool('concernsPrivate'),
    autoApplyTagClusters: pickBool('autoApplyTagClusters'),
  };
}

// 1 フィールド分の永続化 (同期). bool / string / number / null を扱う。
// MMKV は 1 key = 1 value なので、後から set し直すと前の type は上書きされる。
// quietStartHour 系は null を 'null' 文字列マーカーで表現し、number と切り替え可能にする。
function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const fullKey = KEY_PREFIX + (key as string);
  if (key === 'quietStartHour' || key === 'quietEndHour') {
    if (value === null) {
      setString(fullKey, 'null');
    } else if (typeof value === 'number') {
      // setNumber は string マーカーを上書きする (MMKV は 1 key 1 value)
      setNumber(fullKey, value);
    }
    return;
  }
  if (key === 'language') {
    setString(fullKey, value as string);
    return;
  }
  if (typeof value === 'boolean') {
    setBool(fullKey, value);
    return;
  }
}

// 全 settings を一括保存 (旧 AsyncStorage からの migrate 用)
function saveAllSync(s: Settings): void {
  (Object.keys(s) as Array<keyof Settings>).forEach((k) => saveSetting(k, s[k]));
}

// ============================================================
// 旧 AsyncStorage の JSON BLOB を MMKV に migrate (native のみ、1 回限り)
// ============================================================
async function migrateLegacySettings(): Promise<Settings | null> {
  if (Platform.OS === 'web') return null;
  // sentinel が立っていれば既に migrate 済み
  if (storageContains(MIGRATED_FLAG)) return null;
  try {
    const raw = await AsyncStorage.getItem(LEGACY_KEY);
    setBool(MIGRATED_FLAG, true);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const sanitized = sanitizeSettings(parsed);
    saveAllSync(sanitized);
    return sanitized;
  } catch (e) {
    console.warn('[settingsStore] legacy migrate failed:', e);
    // 失敗してもフラグは立てる (毎回試みると hydrate が遅くなる)
    setBool(MIGRATED_FLAG, true);
    return null;
  }
}

// ============================================================
// store
// ============================================================
export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: async () => {
    // MMKV から同期で読む (1ms 以下). 旧 AsyncStorage migration は背景で kick。
    try {
      const sync = loadSettingsSync();
      set({ ...sync, hydrated: true });
    } catch (e) {
      console.warn('[settingsStore] sync hydrate failed, using defaults:', e);
      set({ hydrated: true });
    }
    // 旧データ migrate を待たずに hydrate を完了させ、migrate 後に再反映する。
    // ただし初回ユーザーで MMKV に何も無い場合のみ — 既に何か MMKV に
    // あれば legacy より新しいので無視する。
    void migrateLegacySettings().then((migrated) => {
      if (!migrated) return;
      // hydrate 後に migrate されたら再度反映 (ただし MMKV に既存値が無いケースのみ意味あり)
      // sync 読み出しで DEFAULTS だった場合のみ上書き対象
      const current = get();
      // 全フィールドが DEFAULTS のままなら migrate 値を反映 (loadSettingsSync は MMKV 不在で DEFAULTS を返す)
      const isAllDefault = (Object.keys(DEFAULTS) as Array<keyof Settings>).every(
        (k) => current[k] === DEFAULTS[k],
      );
      if (isAllDefault) {
        set({ ...migrated });
      }
    });
  },
  update: (key, value) => {
    set({ [key]: value } as Pick<Settings, typeof key>);
    // 同期保存 (失敗時は内部で swallow)
    saveSetting(key, value);
  },
}));

// ============================================================
// Quiet hours: 現在時刻が「おやすみ時間」内かを判定
// ============================================================
// 開始 == 終了 や null は無効
// 開始 < 終了:    [開始, 終了)
// 開始 > 終了:    跨日 — [開始, 24) ∪ [0, 終了)
//                例: 22 → 7 は 22:00-07:00 がミュート
// ============================================================
export function isInQuietHours(start: number | null, end: number | null, now = new Date()): boolean {
  if (start === null || end === null) return false;
  if (start === end) return false;
  const h = now.getHours();
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}
