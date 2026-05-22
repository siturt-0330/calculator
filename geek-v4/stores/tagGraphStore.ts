import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// タグツリー(ロジックツリー / マインドマップ風)
// - 各ノードは「タグ or グループ」両方を表す（区別なし）
// - aliases: 別名 (例: "=LOVE" の aliases = ["イコラブ"]) — 同じものを別表記
// - related: 関連タグ (例: "日向坂" の related = ["おひさま"]) — 概念的に紐付く別のもの
// - children: 子ノードの ID (グループ化)
export type TagNode = {
  id: string;
  label: string;
  aliases: string[];
  related: string[];   // 関連タグ
  children: string[];
};

type TagGraphState = {
  nodes: Record<string, TagNode>;
  rootIds: string[];   // ルートに属するノードの順序
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addNode: (label: string, parentId?: string | null) => string;
  removeNode: (id: string) => void;
  renameNode: (id: string, label: string) => void;
  addAlias: (id: string, alias: string) => void;
  addAliases: (id: string, aliases: string[]) => void;
  removeAlias: (id: string, alias: string) => void;
  addRelated: (id: string, related: string) => void;
  addRelatedMulti: (id: string, items: string[]) => void;
  removeRelated: (id: string, related: string) => void;
  moveNode: (id: string, newParentId: string | null) => void;
  moveRoot: (id: string, direction: 'up' | 'down') => void;
  importLikedTags: (tags: string[]) => number;  // returns count added
  applyTemplate: (template: TemplateNode[]) => void;
  reset: () => void;
};

export type TemplateNode = {
  label: string;
  aliases?: string[];
  related?: string[];
  children?: TemplateNode[];
};

export const TEMPLATES: { id: string; name: string; emoji: string; description: string; data: TemplateNode[] }[] = [
  {
    id: 'idol',
    name: 'アイドル',
    emoji: '🎤',
    description: 'アイドルグループの基本テンプレート',
    data: [
      {
        label: 'アイドル',
        children: [
          { label: '坂道シリーズ', children: [
            { label: '乃木坂46', aliases: ['乃木坂'], related: ['乃木オタ'] },
            { label: '櫻坂46', aliases: ['櫻坂', 'さくらざか'], related: ['Buddies'] },
            { label: '日向坂46', aliases: ['日向坂', 'ひなたざか'], related: ['おひさま'] },
          ]},
          { label: 'ハロプロ', aliases: ['ハロー！プロジェクト'], children: [
            { label: 'モーニング娘。', aliases: ['モー娘'] },
          ]},
          { label: '48グループ', children: [
            { label: 'AKB48' },
            { label: 'SKE48' },
          ]},
        ],
      },
    ],
  },
  {
    id: 'vtuber',
    name: 'Vtuber',
    emoji: '👾',
    description: 'Vtuber 事務所別グループ',
    data: [
      {
        label: 'Vtuber',
        aliases: ['VTuber', 'ぶいちゅーばー'],
        children: [
          { label: 'ホロライブ', aliases: ['hololive'] },
          { label: 'にじさんじ', aliases: ['nijisanji'] },
          { label: 'ぶいすぽっ！', aliases: ['ぶいすぽ', 'VSPO'] },
          { label: '個人勢' },
        ],
      },
    ],
  },
  {
    id: 'anime',
    name: 'アニメ',
    emoji: '📺',
    description: 'アニメ作品ジャンル',
    data: [
      {
        label: 'アニメ',
        children: [
          { label: '少年漫画原作' },
          { label: '少女漫画原作' },
          { label: 'ライトノベル原作', aliases: ['ラノベ'] },
          { label: 'オリジナルアニメ' },
        ],
      },
    ],
  },
  {
    id: 'game',
    name: 'ゲーム',
    emoji: '🎮',
    description: 'ゲームジャンル別',
    data: [
      {
        label: 'ゲーム',
        children: [
          { label: 'RPG', aliases: ['ロールプレイング'] },
          { label: 'FPS' },
          { label: 'パズル' },
          { label: 'シミュレーション', aliases: ['シム'] },
          { label: 'ソシャゲ', aliases: ['ソーシャルゲーム'] },
        ],
      },
    ],
  },
];

const KEY = 'geek:tag-graph';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

async function save(snapshot: { nodes: Record<string, TagNode>; rootIds: string[] }) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {}
}

// パフォーマンス監査: 旧版は 3+ 画面 (onboarding/liked-tags, blocked-tags, settings)
// から並列で hydrate() が呼ばれ、毎回 AsyncStorage read + JSON parse + 全 nodes
// reconstruct が走っていた。singleton Promise でロードを 1 回に集約する。
let _hydratePromise: Promise<{ nodes: Record<string, TagNode>; rootIds: string[] }> | null = null;
async function _loadOnce() {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw) as { nodes: Record<string, TagNode>; rootIds: string[] };
        const nodes: Record<string, TagNode> = {};
        for (const [id, n] of Object.entries(data.nodes ?? {})) {
          nodes[id] = {
            ...n,
            aliases: n.aliases ?? [],
            related: n.related ?? [],
            children: n.children ?? [],
          };
        }
        return { nodes, rootIds: data.rootIds ?? [] };
      }
    } catch {}
    return { nodes: {}, rootIds: [] };
  })();
  return _hydratePromise;
}

export const useTagGraphStore = create<TagGraphState>((set, get) => ({
  nodes: {},
  rootIds: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return; // 既に hydrate 済みなら no-op
    const { nodes, rootIds } = await _loadOnce();
    set({ nodes, rootIds, hydrated: true });
  },

  addNode: (label, parentId = null) => {
    const id = uid();
    const node: TagNode = { id, label: label.trim().replace(/^#/, ''), aliases: [], related: [], children: [] };
    const state = get();
    const nodes = { ...state.nodes, [id]: node };
    let rootIds = state.rootIds;
    if (parentId && nodes[parentId]) {
      nodes[parentId] = { ...nodes[parentId]!, children: [...nodes[parentId]!.children, id] };
    } else {
      rootIds = [...state.rootIds, id];
    }
    set({ nodes, rootIds });
    void save({ nodes, rootIds });
    return id;
  },

  removeNode: (id) => {
    const state = get();
    const { [id]: removed, ...remaining } = state.nodes;
    if (!removed) return;
    // 子ノードたちをルートに繰り上げ (子孫を保持)
    const newRootIds = [...state.rootIds.filter((r) => r !== id), ...removed.children];
    // 他のノードからこの ID を参照を除去
    const nodes: Record<string, TagNode> = {};
    for (const [nid, n] of Object.entries(remaining)) {
      nodes[nid] = { ...n, children: n.children.filter((c) => c !== id) };
    }
    set({ nodes, rootIds: newRootIds });
    void save({ nodes, rootIds: newRootIds });
  },

  renameNode: (id, label) => {
    const state = get();
    const node = state.nodes[id];
    if (!node) return;
    const nodes = { ...state.nodes, [id]: { ...node, label: label.trim().replace(/^#/, '') } };
    set({ nodes });
    void save({ nodes, rootIds: state.rootIds });
  },

  addAlias: (id, alias) => {
    const state = get();
    const node = state.nodes[id];
    if (!node) return;
    const a = alias.trim().replace(/^#/, '');
    if (!a || node.aliases.includes(a)) return;
    const nodes = { ...state.nodes, [id]: { ...node, aliases: [...node.aliases, a] } };
    set({ nodes });
    void save({ nodes, rootIds: state.rootIds });
  },

  addAliases: (id, aliases) => {
    const state = get();
    const node = state.nodes[id];
    if (!node) return;
    const existing = new Set(node.aliases);
    const fresh = aliases
      .map((a) => a.trim().replace(/^#/, ''))
      .filter((a) => a && !existing.has(a));
    if (fresh.length === 0) return;
    const nodes = {
      ...state.nodes,
      [id]: { ...node, aliases: [...node.aliases, ...fresh] },
    };
    set({ nodes });
    void save({ nodes, rootIds: state.rootIds });
  },

  removeAlias: (id, alias) => {
    const state = get();
    const node = state.nodes[id];
    if (!node) return;
    const nodes = { ...state.nodes, [id]: { ...node, aliases: node.aliases.filter((a) => a !== alias) } };
    set({ nodes });
    void save({ nodes, rootIds: state.rootIds });
  },

  addRelated: (id, related) => {
    const state = get();
    const node = state.nodes[id];
    if (!node) return;
    const r = related.trim().replace(/^#/, '');
    if (!r || (node.related ?? []).includes(r)) return;
    const nodes = { ...state.nodes, [id]: { ...node, related: [...(node.related ?? []), r] } };
    set({ nodes });
    void save({ nodes, rootIds: state.rootIds });
  },

  addRelatedMulti: (id, items) => {
    const state = get();
    const node = state.nodes[id];
    if (!node) return;
    const existing = new Set(node.related ?? []);
    const fresh = items
      .map((a) => a.trim().replace(/^#/, ''))
      .filter((a) => a && !existing.has(a));
    if (fresh.length === 0) return;
    const nodes = {
      ...state.nodes,
      [id]: { ...node, related: [...(node.related ?? []), ...fresh] },
    };
    set({ nodes });
    void save({ nodes, rootIds: state.rootIds });
  },

  removeRelated: (id, related) => {
    const state = get();
    const node = state.nodes[id];
    if (!node) return;
    const nodes = { ...state.nodes, [id]: { ...node, related: (node.related ?? []).filter((r) => r !== related) } };
    set({ nodes });
    void save({ nodes, rootIds: state.rootIds });
  },

  moveNode: (id, newParentId) => {
    const state = get();
    if (!state.nodes[id]) return;
    if (id === newParentId) return;
    // 循環参照を防ぐ: 子孫に new parent が含まれていたら却下
    const isDescendant = (rootId: string, target: string): boolean => {
      const visited = new Set<string>();
      const stack = [rootId];
      while (stack.length) {
        const cur = stack.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        if (cur === target) return true;
        const node = state.nodes[cur];
        if (node) stack.push(...node.children);
      }
      return false;
    };
    if (newParentId && isDescendant(id, newParentId)) return;
    // 古い親 or root から除去
    let rootIds = state.rootIds.filter((r) => r !== id);
    const nodes: Record<string, TagNode> = {};
    for (const [nid, n] of Object.entries(state.nodes)) {
      nodes[nid] = { ...n, children: n.children.filter((c) => c !== id) };
    }
    // 新しい親 or root に追加
    if (newParentId && nodes[newParentId]) {
      nodes[newParentId] = { ...nodes[newParentId]!, children: [...nodes[newParentId]!.children, id] };
    } else {
      rootIds = [...rootIds, id];
    }
    set({ nodes, rootIds });
    void save({ nodes, rootIds });
  },

  moveRoot: (id, direction) => {
    const state = get();
    const idx = state.rootIds.indexOf(id);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= state.rootIds.length) return;
    const rootIds = [...state.rootIds];
    [rootIds[idx], rootIds[newIdx]] = [rootIds[newIdx]!, rootIds[idx]!];
    set({ rootIds });
    void save({ nodes: state.nodes, rootIds });
  },

  importLikedTags: (tags) => {
    const state = get();
    // 既存のすべてのラベル＋別名
    const existing = new Set<string>();
    for (const n of Object.values(state.nodes)) {
      existing.add(n.label);
      for (const a of n.aliases) existing.add(a);
    }
    const newNodes: Record<string, TagNode> = { ...state.nodes };
    const newRoots: string[] = [...state.rootIds];
    let count = 0;
    for (const t of tags) {
      const clean = t.trim().replace(/^#/, '');
      if (!clean || existing.has(clean)) continue;
      const id = uid();
      newNodes[id] = { id, label: clean, aliases: [], related: [], children: [] };
      newRoots.push(id);
      existing.add(clean);
      count++;
    }
    if (count > 0) {
      set({ nodes: newNodes, rootIds: newRoots });
      void save({ nodes: newNodes, rootIds: newRoots });
    }
    return count;
  },

  applyTemplate: (template) => {
    const state = get();
    const nodes: Record<string, TagNode> = { ...state.nodes };
    const newRootIds: string[] = [];

    const build = (tn: TemplateNode, parentId: string | null): string => {
      const id = uid();
      const childIds: string[] = [];
      const node: TagNode = {
        id,
        label: tn.label,
        aliases: tn.aliases ?? [],
        related: tn.related ?? [],
        children: childIds,
      };
      nodes[id] = node;
      for (const child of tn.children ?? []) {
        childIds.push(build(child, id));
      }
      // children を確定
      nodes[id] = { ...node, children: childIds };
      return id;
    };

    for (const tn of template) {
      const id = build(tn, null);
      newRootIds.push(id);
    }
    const rootIds = [...state.rootIds, ...newRootIds];
    set({ nodes, rootIds });
    void save({ nodes, rootIds });
  },

  reset: () => {
    set({ nodes: {}, rootIds: [] });
    void save({ nodes: {}, rootIds: [] });
  },
}));
