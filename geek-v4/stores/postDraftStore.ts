import { create } from 'zustand';
import type { PostVisibility } from '../lib/api/posts';
import type { Community } from '../lib/api/communities';

export type PickedVideo = { uri: string; mime: string; ext: string; size: number };
export type CWCat = 'none' | 'spoiler' | 'nsfw' | 'violence' | 'sensitive';

// デフォルト値を定数に切り出しておくと reset() が簡潔になる。
const DEFAULT_STATE = {
  // ---- Step 1: コンテンツ ----
  title: '',
  content: '',
  images: [] as string[],
  video: null as PickedVideo | null,
  anonymous: true,

  // ---- Step 2: 設定 ----
  tags: [] as string[],
  visibility: 'public' as PostVisibility,
  selectedCommunityIds: [] as string[],
  selectedCommunities: [] as Community[],
  cwCategory: 'none' as CWCat,
  cwText: '',
  sourceUrl: '',
  showPoll: false,
  pollQuestion: '',
  pollOptions: ['', ''] as string[],
  pollMulti: false,
  pollHours: 24 as number | null,
};

interface PostDraftState {
  // ---- Step 1: コンテンツ ----
  title: string;
  content: string;
  images: string[];
  video: PickedVideo | null;
  anonymous: boolean;

  // ---- Step 2: 設定 ----
  tags: string[];
  visibility: PostVisibility;
  selectedCommunityIds: string[];
  selectedCommunities: Community[];
  cwCategory: CWCat;
  cwText: string;
  sourceUrl: string;
  showPoll: boolean;
  pollQuestion: string;
  pollOptions: string[];
  pollMulti: boolean;
  pollHours: number | null;

  // ---- Actions ----
  setTitle: (t: string) => void;
  setContent: (c: string) => void;
  setImages: (imgs: string[]) => void;
  setVideo: (v: PickedVideo | null) => void;
  setAnonymous: (a: boolean) => void;
  setTags: (tags: string[]) => void;
  setVisibility: (v: PostVisibility) => void;
  setSelectedCommunities: (ids: string[], communities: Community[]) => void;
  setCwCategory: (c: CWCat) => void;
  setCwText: (t: string) => void;
  setSourceUrl: (u: string) => void;
  setPoll: (show: boolean, question: string, options: string[], multi: boolean, hours: number | null) => void;
  reset: () => void;
}

export const usePostDraftStore = create<PostDraftState>()((set) => ({
  ...DEFAULT_STATE,

  setTitle: (t) => set(() => ({ title: t })),
  setContent: (c) => set(() => ({ content: c })),
  setImages: (imgs) => set(() => ({ images: imgs })),
  setVideo: (v) => set(() => ({ video: v })),
  setAnonymous: (a) => set(() => ({ anonymous: a })),
  setTags: (tags) => set(() => ({ tags })),
  setVisibility: (v) => set(() => ({ visibility: v })),
  setSelectedCommunities: (ids, communities) =>
    set(() => ({ selectedCommunityIds: ids, selectedCommunities: communities })),
  setCwCategory: (c) => set(() => ({ cwCategory: c })),
  setCwText: (t) => set(() => ({ cwText: t })),
  setSourceUrl: (u) => set(() => ({ sourceUrl: u })),
  setPoll: (show, question, options, multi, hours) =>
    set(() => ({ showPoll: show, pollQuestion: question, pollOptions: options, pollMulti: multi, pollHours: hours })),
  reset: () => set(() => ({ ...DEFAULT_STATE })),
}));
