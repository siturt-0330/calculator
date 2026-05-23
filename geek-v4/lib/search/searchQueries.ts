// ============================================================
// searchQueries.ts — search screen のサーバー側 fetch ヘルパー
// ============================================================
// app/search.tsx から抽出。SearchScreen の UI ロジックと分離して、
// 各 fetcher を単体で reuse / テスト できる状態にする。
// pure API レイヤ — supabase クライアントしか触らない。
// ============================================================
import { supabase } from '../supabase';
import type { PostDoc, TagDoc } from './scoring';

export type BBSResult = {
  id: string;
  title: string;
  category: string;
  replies_count: number;
  created_at: string;
};

// ============= タグ検索 =============
// `name.ilike.%<q>%` の OR を最大 16 個まで構築。
// PostgREST or() の文字数制限を意識して slice(0, 16)。
export async function fetchTags(queries: string[]): Promise<TagDoc[]> {
  if (queries.length === 0) return [];
  const filters = queries.slice(0, 16).map((q) => `name.ilike.%${q}%`).join(',');
  const { data } = await supabase
    .from('tags')
    .select('name, post_count, member_count')
    .or(filters)
    .order('member_count', { ascending: false })
    .limit(60);
  return (data ?? []) as TagDoc[];
}

// 全タグ (人気順 top 200) — search 候補表示の初期値に使う
export async function fetchAllTags(): Promise<string[]> {
  const { data } = await supabase
    .from('tags')
    .select('name')
    .order('member_count', { ascending: false })
    .limit(200);
  return (data ?? []).map((t: { name: string }) => t.name);
}

// ============= 投稿検索 =============
// 本文検索 (content.ilike) + タグ overlap 検索の 2 段で取得して merge。
// 匿名 + 公開投稿のみが対象 (search screen は実名投稿には触らない)。
export async function fetchPosts(queries: string[], tagFilters: string[]): Promise<PostDoc[]> {
  const map = new Map<string, PostDoc>();
  const SELECT = 'id, content, tag_names, likes_count, comments_count, concern_count, created_at, trust_score_at_post, media_urls, source_url, kind';

  // 本文検索
  if (queries.length > 0) {
    const filters = queries.slice(0, 16).map((q) => `content.ilike.%${q}%`).join(',');
    const { data } = await supabase
      .from('posts').select(SELECT).or(filters)
      .eq('is_anonymous', true).eq('is_public', true)
      .order('created_at', { ascending: false }).limit(80);
    for (const p of (data ?? []) as PostDoc[]) map.set(p.id, p);
  }
  // タグ overlap 検索
  const tagQueries = [...queries, ...tagFilters].filter(Boolean).slice(0, 12);
  if (tagQueries.length > 0) {
    const { data } = await supabase
      .from('posts').select(SELECT).overlaps('tag_names', tagQueries)
      .eq('is_anonymous', true).eq('is_public', true)
      .order('created_at', { ascending: false }).limit(80);
    for (const p of (data ?? []) as PostDoc[]) map.set(p.id, p);
  }
  return [...map.values()];
}

// ============= BBS 検索 =============
// タイトル ilike 検索。同タイトル + 同カテゴリの重複は dedupe
// (seed data や bot クローンのスレッドが何個も並ぶのを防ぐ)。
export async function fetchBBS(q: string): Promise<BBSResult[]> {
  if (!q) return [];
  const { data } = await supabase
    .from('bbs_threads')
    .select('id, title, category, replies_count, created_at')
    .ilike('title', `%${q}%`)
    .order('last_reply_at', { ascending: false, nullsFirst: false })
    .limit(30);
  const rows = (data ?? []) as BBSResult[];
  // 同タイトル + 同カテゴリの重複を dedupe — seed data や bot クローンのスレッドが
  // 何個も並ぶのを防ぐ
  const seen = new Map<string, BBSResult>();
  for (const r of rows) {
    const key = `${(r.title || '').trim().toLowerCase()}|${r.category}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
    } else {
      // 返信数が多い方を残す (より「活発な方」)
      if ((r.replies_count ?? 0) > (existing.replies_count ?? 0)) seen.set(key, r);
    }
  }
  return [...seen.values()];
}
