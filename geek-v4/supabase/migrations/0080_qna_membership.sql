-- ============================================================
-- 0080_qna_membership.sql
-- ============================================================
-- Audit B#3 fix: qna_search_documents の membership ゲート追加
--
-- 経緯:
--   - 0032 で `qna_search_documents(uuid, text, int)` を SECURITY DEFINER で定義
--   - 0072 で limit cap (LEAST(p_limit, 100)) を追加 (こちらが直近の version)
--   - いずれも caller の membership を check しておらず、認証済みユーザーなら
--     どのコミュの QnA ドキュメントでも full-text 検索 + 全文取得できてしまう
--     (community visibility / is_official を無視するバイパス)
--
-- 修正方針:
--   - 関数本体冒頭で membership ゲートを追加:
--       (1) public.is_community_member(p_community_id) が true
--       (2) OR コミュニティが is_official または visibility='open' (公開コミュ)
--     のどちらかを満たさない場合は `raise exception 'forbidden: not a member'`
--     (errcode = '42501' insufficient_privilege)
--   - clamp (LEAST(p_limit, 100)) は 0072 の挙動を維持
--   - SECURITY DEFINER, search_path = public, stable は維持
--   - language を sql から plpgsql に変更 (raise exception を使うため)
--
-- 依存:
--   - public.is_community_member(uuid) は 0017_communities.sql:171 で定義済
--   - public.communities.is_official は 0032_official_communities.sql:21 で追加済
--   - public.communities.visibility は 0017_communities.sql:32 で定義済
--
-- 冪等性:
--   - create or replace function なので何度実行しても OK
--   - drop function は使わない (依存 grant が壊れるため、create or replace で同シグネチャ上書き)
-- ============================================================

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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- membership ゲート: メンバーでもなく、公開 / 公式コミュでもない場合は拒否
  if not (
    public.is_community_member(p_community_id)
    or exists (
      select 1 from public.communities
      where id = p_community_id
        and (is_official or visibility = 'open')
    )
  ) then
    raise exception 'forbidden: not a member' using errcode = '42501';
  end if;

  return query
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
end;
$$;

-- grant 再付与 (create or replace では grant は維持されるが念のため再宣言)
grant execute on function public.qna_search_documents(uuid, text, int) to authenticated;
