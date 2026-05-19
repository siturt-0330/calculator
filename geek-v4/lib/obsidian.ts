// ============================================================
// Obsidian 連携
// ============================================================
// Obsidian は `obsidian://` URI スキームで「新規ノート作成」が呼べる。
// 追加 dependency なしで web / iOS / Android すべて動作する (Obsidian
// インストール済の場合)。
//
//   obsidian://new?vault=VaultName&name=NoteName&content=URI-encoded&silent=true
//
// vault 名は設定で保存しておく → 各投稿に「Obsidian に保存」ボタンを
// 付ければ 1 タップで vault にノートが作られる。
// ============================================================

import { Platform, Linking } from 'react-native';

const VAULT_KEY = 'geek:obsidian_vault';
const ENABLED_KEY = 'geek:obsidian_enabled';

// 保存 / 取得 — AsyncStorage 経由 (web は localStorage)
import AsyncStorage from '@react-native-async-storage/async-storage';

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
// Markdown 整形
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

// YAML frontmatter + 本文。Obsidian の standard 形式に合わせる
export function formatPostAsMarkdown(post: PostMeta): string {
  const lines: string[] = [];
  const date = post.createdAt ? new Date(post.createdAt).toISOString().slice(0, 10) : '';
  // frontmatter
  lines.push('---');
  lines.push('source: geek-v4');
  lines.push(`geek_id: ${post.id}`);
  if (date) lines.push(`date: ${date}`);
  if (post.kind) lines.push(`kind: ${post.kind}`);
  if (post.tagNames && post.tagNames.length > 0) {
    // YAML inline array — Obsidian の tag は #tag 形式だが frontmatter は単独 string
    lines.push(`tags:`);
    for (const t of post.tagNames) lines.push(`  - ${t}`);
  }
  if (typeof post.likesCount === 'number') lines.push(`likes: ${post.likesCount}`);
  if (typeof post.commentsCount === 'number') lines.push(`comments: ${post.commentsCount}`);
  if (post.sourceUrl) lines.push(`source_url: ${post.sourceUrl}`);
  lines.push('---');
  lines.push('');
  // 本文
  lines.push(post.content);
  // 添付画像
  if (post.mediaUrls && post.mediaUrls.length > 0) {
    lines.push('');
    lines.push('## 添付');
    for (const url of post.mediaUrls) {
      lines.push(`![](${url})`);
    }
  }
  return lines.join('\n');
}

export function formatNoteName(post: { id: string; createdAt?: string; content: string }): string {
  // Obsidian ノート名 — 日付 + content 先頭 40 文字
  const date = post.createdAt ? new Date(post.createdAt).toISOString().slice(0, 10) : '';
  const firstLine = post.content.split('\n')[0] ?? '';
  // Obsidian ファイル名に使えない文字を除去
  const safeFirst = firstLine.replace(/[\\\/:*?"<>|#\[\]^]/g, '').slice(0, 40).trim();
  return `${date} Geek - ${safeFirst || post.id.slice(0, 8)}`;
}

// ============================================================
// URI 起動
// ============================================================

export async function saveToObsidian(post: PostMeta): Promise<{ ok: boolean; reason?: string }> {
  const vault = await getObsidianVault();
  if (!vault) {
    return { ok: false, reason: 'vault_not_set' };
  }
  if (!(await isObsidianEnabled())) {
    return { ok: false, reason: 'disabled' };
  }
  const noteName = formatNoteName(post);
  const content = formatPostAsMarkdown(post);
  // silent=true で Obsidian がフォアグラウンドに来ずバックグラウンドで保存
  // (アプリから離脱しないので連投できる)
  const uri =
    `obsidian://new?vault=${encodeURIComponent(vault)}` +
    `&name=${encodeURIComponent(noteName)}` +
    `&content=${encodeURIComponent(content)}` +
    `&silent=true`;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // location.href 経由だと Obsidian が無い時に "ページが見つかりません" になるので
      // 新規タブで開く (ユーザーが Obsidian アプリでハンドルしてくれることを期待)
      window.open(uri, '_self');
      return { ok: true };
    }
    const supported = await Linking.canOpenURL(uri).catch(() => true);
    if (!supported) {
      return { ok: false, reason: 'obsidian_not_installed' };
    }
    await Linking.openURL(uri);
    return { ok: true };
  } catch (e) {
    console.warn('[obsidian] open URI failed:', e);
    return { ok: false, reason: 'launch_failed' };
  }
}

// 「Obsidian に開く」だけ (vault root を開く) — 連携確認用
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
