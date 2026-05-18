import { create } from 'zustand';

// ============================================================
// Intro animation replay store
// ============================================================
// イントロアニメーションを画面上の任意の場所から再生できるようにする
// _layout.tsx が key={replayKey} で IntroAnimation を再マウントすることで
// アニメーションを何度でも再生可能。
// ============================================================

type IntroState = {
  // 表示中フラグ。true の間 IntroAnimation がレンダーされる
  playing: boolean;
  // 再生のたびに増えるカウンタ。これを key に渡して強制リマウント
  replayKey: number;
  play: () => void;
  finish: () => void;
};

export const useIntroStore = create<IntroState>((set) => ({
  playing: false,
  replayKey: 0,
  play: () => set((s) => ({ playing: true, replayKey: s.replayKey + 1 })),
  finish: () => set({ playing: false }),
}));
