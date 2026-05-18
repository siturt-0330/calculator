import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
};

const KEY = 'geek:settings';

type SettingsState = Settings & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Settings>;
        set({ ...DEFAULTS, ...parsed, hydrated: true });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },
  update: (key, value) => {
    set({ [key]: value } as Pick<Settings, typeof key>);
    const state = get();
    const toSave: Settings = {
      language: state.language,
      pushEnabled: state.pushEnabled,
      notifyLike: state.notifyLike,
      notifyComment: state.notifyComment,
      notifyFollow: state.notifyFollow,
      notifyEvent: state.notifyEvent,
      notifyReply: state.notifyReply,
      notifyMention: state.notifyMention,
      notifyTagNew: state.notifyTagNew,
      notifyAnnouncement: state.notifyAnnouncement,
      quietStartHour: state.quietStartHour,
      quietEndHour: state.quietEndHour,
      reduceMotion: state.reduceMotion,
      dataSaver: state.dataSaver,
      concernsPrivate: state.concernsPrivate,
    };
    AsyncStorage.setItem(KEY, JSON.stringify(toSave)).catch(() => {});
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
