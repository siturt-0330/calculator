-- ============================================================
-- 0071_pagination_caps.sql — RPC の p_limit に clamp を追加
-- ------------------------------------------------------------
-- Audit G で指摘された unbounded queries 対策の DB 側施策。
-- クライアントが意図せず巨大な p_limit (例: 100000) を渡しても
-- サーバ側で 100 件で打ち切ることで OOM / latency spike を防ぐ。
--
-- 対象 RPC:
--   - fetch_targeted_ads (0035 で定義)  → 元の default 3, clamp 100
--   - qna_search_documents (0032 で定義) → 元の default 5, clamp 100
--
-- 注意 (CLAUDE.md § 7):
--   - 既存 migration の編集は禁止 (idempotency 崩壊の原因)
--   - revert / 修正は新 file で行う → 本 file がそれ
--   - CREATE OR REPLACE FUNCTION で関数を差し替える (signature 不変)
-- ============================================================

-- ------------------------------------------------------------
-- fetch_targeted_ads(p_interest_tags, p_exclude_tags, p_limit)
-- ------------------------------------------------------------
-- LEAST(p_limit, 100) でサーバ側上限をかける。
-- p_limit に NULL を渡された場合は default 3 が effective なので
-- COALESCE で念のため null 安全化 (security definer なので robust に)。
create or replace function public.fetch_targeted_ads(
  p_interest_tags text[],
  p_exclude_tags text[] default '{}'::text[],
  p_limit int default 3
)
returns table (
  id uuid,
  advertiser_name text,
  headline text,
  body text,
  image_url text,
  click_url text,
  cta_label text,
  target_tags text[],
  match_score real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.advertiser_name,
    a.headline,
    a.body,
    a.image_url,
    a.click_url,
    a.cta_label,
    a.target_tags,
    (
      select count(*)::real
        from unnest(a.target_tags) as t
       where t = any(p_interest_tags)
    )
      + (case when a.target_tags = '{}'::text[] then 0.1 else 0 end)
    as match_score
  from public.ads a
  where a.status = 'active'
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at is null or a.ends_at > now())
    and not (a.exclude_tags && p_interest_tags)
    and not (a.target_tags && p_exclude_tags)
    and (a.target_tags = '{}'::text[] or a.target_tags && p_interest_tags)
  order by match_score desc, random()
  limit least(coalesce(p_limit, 3), 100);
$$;

grant execute on function public.fetch_targeted_ads(text[], text[], int) to authenticated;

-- ------------------------------------------------------------
-- qna_search_documents(p_community_id, p_query, p_limit)
-- ------------------------------------------------------------
-- 同様に LEAST(p_limit, 100) で clamp。
-- QnA 検索結果が 100 件超になることはまず無いが、悪意ある呼び出しで
-- 全文検索ヒットを大量に返させるパターンを防ぐ。
create or replace function public.qna_search_documents(
  p_community_id uuid,
  p_query text,
  p_limit int default 5
)
returns table (
  id uuid,
  title text,
  content text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id, d.title, d.content,
    ts_rank(d.search_tsv, plainto_tsquery('simple', p_query)) as rank
  from public.community_qna_documents d
  where d.community_id = p_community_id
    and (
      d.search_tsv @@ plainto_tsquery('simple', p_query)
      or d.title ilike '%' || p_query || '%'
      or d.content ilike '%' || p_query || '%'
    )
  order by rank desc, d.created_at desc
  limit least(coalesce(p_limit, 5), 100);
$$;

grant execute on function public.qna_search_documents(uuid, text, int) to authenticated;
