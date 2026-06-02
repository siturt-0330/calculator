// ============================================================
// stores/videoLightboxStore.ts — 全画面動画ビューア (VideoLightbox) のグローバル状態
// ------------------------------------------------------------
// 画像の ImageLightbox に相当する「動画版」。アプリ全体で 1 つだけ <VideoLightbox /> を
// root (_layout) に常駐させ、各所の VideoPlayer タップから open(uri, poster) で開く。
//   - selector で購読すること (CLAUDE.md §5.4)。
// ============================================================
import { create } from 'zustand';

type VideoLightboxState = {
  uri: string | null;
  poster: string | null;
  open: (uri: string, poster?: string | null) => void;
  close: () => void;
};

export const useVideoLightboxStore = create<VideoLightboxState>((set) => ({
  uri: null,
  poster: null,
  open: (uri, poster = null) => set({ uri, poster }),
  close: () => set({ uri: null, poster: null }),
}));
