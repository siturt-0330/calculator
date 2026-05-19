// ============================================================
// Obsidian 連携 (汎用)
// ============================================================
// Obsidian は `obsidian://` URI スキームで「新規ノート作成」が呼べる。
// 追加 dependency なしで web / iOS / Android すべて動作する。
//
//   obsidian://new?vault=VaultName&name=NoteName&content=URI-encoded&silent=true
//
// vault 名は設定で保存しておく → 各 surface (post / community / bbs / comment) に
// 1 タップ保存ボタンを置く。
// ============================================================

import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const VAULT_KEY = 'geek:obsidian_vault';
const ENABLED_KEY = 'geek:obsidian_enabled';

async function rawGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return window.localStorage.getItem(key);
    }
    return AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}
async function rawSet(key: string, value: string) {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    console.warn('[obsidian] storage set failed:', e);
  }
}

export async function getObsidianVault(): Promise<string | null> {
  return rawGet(VAULT_KEY);
}
export async function setObsidianVault(name: string): Promise<void> {
  await rawSet(VAULT_KEY, name.trim());
}
export async function isObsidianEnabled(): Promise<boolean> {
  return (await rawGet(ENABLED_KEY)) === '1';
}
export async function setObsidianEnabled(v: boolean): Promise<void> {
  await rawSet(ENABLED_KEY, v ? '1' : '0');
}

// ============================================================
// 汎用 Note 定義 — 全 surface で使える generic 構造
// ============================================================

export type ObsidianNote = {
  // 必須
  id: string;
  content: string;
  // タイプ別カテゴリ — frontmatter の type に入る
  type: 'post' | 'community_post' | 'bbs_thread' | 'bbs_reply' | 'comment' | 'community';
  // 任意メタ
  title?: string;             // タイトル付き (BBS thread / community) 用
  createdAt?: string;
  tagNames?: string[];
  likesCount?: number;
  commentsCount?: number;
  sourceUrl?: string | null;
  mediaUrls?: string[];
  kind?: string | null;
  // コミュニティ情報 (community_post の場合)
  communityName?: string;
  communityId?: string;
  // BBS 情報 (bbs_reply の場合)
  threadTitle?: string;
  threadId?: string;
  // 返信元 (comment の場合)
  parentPostId?: string;
  parentPostContent?: string;
  // 著者情報 (匿名なら省略)
  authorNickname?: string;
};

// type → 日本語ラベル (frontmatter / ノート名で使う)
const TYPE_LABEL: Record<ObsidianNote['type'], string> = {
  post: '投稿',
  community_post: 'コミュニティ投稿',
  bbs_thread: 'BBS スレ',
  bbs_reply: 'BBS 返信',
  comment: 'コメント',
  community: 'コミュニティ',
};

// YAML escape — frontmatter の値で `: ` や `#` を含む場合 quote で囲む
function yamlVal(v: string): string {
  if (v.length === 0) return '""';
  if (/[:#\[\]&*!|>'"%@`]/.test(v) || /^\s|\s$/.test(v)) {
    // ダブルクォート escape: " → \"
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

// 1 ノート分の Markdown 整形
export function formatNoteAsMarkdown(note: ObsidianNote): string {
  const lines: string[] = [];
  const date = note.createdAt ? new Date(note.createdAt).toISOString().slice(0, 10) : '';
  lines.push('---');
  lines.push(`source: geek-v4`);
  lines.push(`geek_id: ${note.id}`);
  lines.push(`type: ${note.type}`);
  lines.push(`type_label: ${yamlVal(TYPE_LABEL[note.type])}`);
  if (date) lines.push(`date: ${date}`);
  if (note.kind) lines.push(`kind: ${yamlVal(note.kind)}`);
  if (note.title) lines.push(`title: ${yamlVal(note.title)}`);
  if (note.communityName) lines.push(`community: ${yamlVal(note.communityName)}`);
  if (note.threadTitle) lines.push(`thread: ${yamlVal(note.threadTitle)}`);
  if (note.authorNickname) lines.push(`author: ${yamlVal(note.authorNickname)}`);
  if (note.tagNames && note.tagNames.length > 0) {
    lines.push('tags:');
    for (const t of note.tagNames) lines.push(`  - ${yamlVal(t)}`);
  }
  if (typeof note.likesCount === 'number') lines.push(`likes: ${note.likesCount}`);
  if (typeof note.commentsCount === 'number') lines.push(`comments: ${note.commentsCount}`);
  if (note.sourceUrl) lines.push(`source_url: ${yamlVal(note.sourceUrl)}`);
  lines.push('---');
  lines.push('');
  // タイトル行を入れる (frontmatter とは別に H1)
  if (note.title) {
    lines.push(`# ${note.title}`);
    lines.push('');
  }
  lines.push(note.content);
  // 添付画像
  if (note.mediaUrls && note.mediaUrls.length > 0) {
    lines.push('');
    lines.push('## 添付');
    for (const url of note.mediaUrls) {
      lines.push(`![](${url})`);
    }
  }
  // 親投稿への文脈 (comment / bbs_reply 用)
  if (note.parentPostContent) {
    lines.push('');
    lines.push('---');
    lines.push('## 元の投稿');
    lines.push('');
    lines.push(note.parentPostContent);
  }
  return lines.join('\n');
}

// Obsidian ノート名生成 — 日付 + 種別 + 本文先頭
export function formatNoteName(note: ObsidianNote): string {
  const date = note.createdAt ? new Date(note.createdAt).toISOString().slice(0, 10) : '';
  const baseTitle = note.title || note.content.split('\n')[0] || note.id.slice(0, 8);
  // Obsidian ファイル名に使えない文字を除去
  const safe = baseTitle.replace(/[\\\/:*?"<>|#\[\]^]/g, '').slice(0, 40).trim();
  const label = TYPE_LABEL[note.type];
  return `${date} ${label} - ${safe || note.id.slice(0, 8)}`;
}

// ============================================================
// URI 起動
// ============================================================

export async function saveNoteToObsidian(note: ObsidianNote): Promise<{ ok: boolean; reason?: string }> {
  const vault = await getObsidianVault();
  if (!vault) return { ok: false, reason: 'vault_not_set' };
  if (!(await isObsidianEnabled())) return { ok: false, reason: 'disabled' };
  const noteName = formatNoteName(note);
  const content = formatNoteAsMarkdown(note);
  const uri =
    `obsidian://new?vault=${encodeURIComponent(vault)}` +
    `&name=${encodeURIComponent(noteName)}` +
    `&content=${encodeURIComponent(content)}` +
    `&silent=true`;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(uri, '_self');
      return { ok: true };
    }
    const supported = await Linking.canOpenURL(uri).catch(() => true);
    if (!supported) return { ok: false, reason: 'obsidian_not_installed' };
    await Linking.openURL(uri);
    return { ok: true };
  } catch (e) {
    console.warn('[obsidian] open URI failed:', e);
    return { ok: false, reason: 'launch_failed' };
  }
}

// vault root を開く (連携確認用)
export async function openObsidianVault(): Promise<boolean> {
  const vault = await getObsidianVault();
  if (!vault) return false;
  const uri = `obsidian://open?vault=${encodeURIComponent(vault)}`;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(uri, '_self');
      return true;
    }
    await Linking.openURL(uri);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 後方互換 (1 つ目の commit で使ったエイリアス)
// ============================================================

type PostMeta = {
  id: string;
  content: string;
  tagNames?: string[];
  createdAt?: string;
  likesCount?: number;
  commentsCount?: number;
  sourceUrl?: string | null;
  kind?: string | null;
  mediaUrls?: string[];
};

export function formatPostAsMarkdown(post: PostMeta): string {
  return formatNoteAsMarkdown({ ...post, type: 'post' });
}

export async function saveToObsidian(post: PostMeta): Promise<{ ok: boolean; reason?: string }> {
  return saveNoteToObsidian({ ...post, type: 'post' });
}

// ============================================================
// 一括 export (saved post / 自分の投稿一覧など)
// 連投を防ぐため delay を入れて順次 Obsidian に投げる
// ============================================================

export async function saveBatchToObsidian(
  notes: ObsidianNote[],
  opts: { delayMs?: number; onProgress?: (current: number, total: number) => void } = {},
): Promise<{ success: number; failed: number }> {
  const { delayMs = 350, onProgress } = opts;
  let success = 0;
  let failed = 0;
  for (let i = 0; i < notes.length; i++) {
    onProgress?.(i, notes.length);
    const n = notes[i];
    if (!n) continue;
    const r = await saveNoteToObsidian(n);
    if (r.ok) success += 1;
    else failed += 1;
    // OS の URL ハンドラを詰まらせないよう wait
    if (i < notes.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  onProgress?.(notes.length, notes.length);
  return { success, failed };
}
