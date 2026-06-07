-- ============================================================
-- 0128_admin_author_rpcs.sql
-- ============================================================
-- 目的: 将来 `REVOKE SELECT (author_id) ON public.posts FROM authenticated`
--   を実行しても ADMIN コンソールが動き続けるようにする。
--
--   admin (= 'authenticated' ロール) は現状 posts.author_id を直読しているが、
--   匿名性ハードニング (security/deanon-phase2) で author_id の列レベル SELECT を
--   authenticated から剥奪する予定。剥奪後は admin の直読も壊れる。
--
--   そこで「admin が意図的に身元を見る」読みを全て SECURITY DEFINER RPC に移し、
--   関数 owner 権限で author_id を読む。各 RPC は先頭で is_admin() を強制ゲートする
--   (0118 get_report_queue / 0120 set_admin_role と同方針)。
--
-- 設計上の約束 (0118 / 0120 と統一):
--   * top-level の create or replace (SQL editor の nested do-block 誤分割対策)。
--   * language plpgsql security definer set search_path = public, pg_temp。
--   * 各関数の先頭で
--       if not is_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
--   * grant execute ... to authenticated (実際の権限判定は関数内 is_admin() ゲート)。
--   * is_admin() は 0027/0120、current_user_is_admin() は 0020 で定義済 (前提)。
--
-- 冪等。SQL editor 手動適用前提 (Netlify は migration を流さない)。
--   未適用でも client は isRpcMissing fallback で従来の直読経路に倒れる
--   (= 0128 適用前 / author_id REVOKE 前は壊れない)。REVOKE 後は本 RPC が必須。
--
-- 参照: 0031_admin_moderation.sql (admin_reported_posts_v / moderation_log /
--       admin_delete_all_user_posts の moderation_log shape) / 0118_report_cases.sql
--       (get_report_queue の admin gate + json_build_object パターン)。
-- ============================================================

-- ------------------------------------------------------------
-- 1) admin_reported_posts — 通報(concern)集計付きの通報投稿一覧
-- ------------------------------------------------------------
-- 旧: admin_reported_posts_v (concern 集計ビュー) + 別途 profiles から nickname を
--     N+1 で引いていた。author_id 列が REVOKE されるとビュー経由でも引けなくなるため、
--     definer 関数内で集計 + nickname join まで一括で行い JSON 配列を返す。
--
-- セマンティクスは admin_reported_posts_v に一致させる:
--   reports_count   = count(c.user_id)  (concerns は PK (user_id,post_id) なので
--                     1 ユーザー 1 投稿 1 行 = 実質 distinct reporter 数)
--   last_reported_at = max(c.created_at)
-- concern が 1 件も無い投稿は出さない (ビューが join (= inner) だったのに合わせる)。
create or replace function public.admin_reported_posts(
  p_min_reports int  default 1,
  p_limit       int  default 100,
  p_search      text default null
)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_min    int;
  v_limit  int;
  v_result json;
begin
  if not is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  v_min   := greatest(coalesce(p_min_reports, 1), 1);
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

  select coalesce(
           json_agg(t order by t.reports_count desc, t.last_reported_at desc),
           '[]'::json
         )
    into v_result
  from (
    select
      p.id                                   as post_id,
      p.author_id                            as author_id,
      pr.nickname                            as author_nickname,
      p.content                              as content,
      p.visibility                           as visibility,
      p.created_at                           as post_created_at,
      p.likes_count                          as likes_count,
      p.concern_count                        as concern_count,
      count(c.user_id)                       as reports_count,
      max(c.created_at)                      as last_reported_at
    from public.posts p
    join public.concerns c on c.post_id = p.id
    left join public.profiles pr on pr.id = p.author_id
    where (p_search is null or p_search = '' or p.content ilike '%' || p_search || '%')
    group by p.id, pr.nickname
    having count(c.user_id) >= v_min
    order by reports_count desc, last_reported_at desc
    limit v_limit
  ) t;

  return coalesce(v_result, '[]'::json);
end;
$fn$;

grant execute on function public.admin_reported_posts(int, int, text) to authenticated;

-- ------------------------------------------------------------
-- 2) admin_user_posts — 指定ユーザーの投稿一覧 (author_id 込み)
-- ------------------------------------------------------------
-- 旧: posts を .eq('author_id', userId) で直読 + concerns を posts!inner(author_id)
--     embed filter していた。どちらも author_id 列 SELECT に依存するため definer 化。
create or replace function public.admin_user_posts(
  p_user_id uuid,
  p_limit   int default 50
)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_limit  int;
  v_result json;
begin
  if not is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  select coalesce(
           json_agg(t order by t.created_at desc),
           '[]'::json
         )
    into v_result
  from (
    select
      p.id            as id,
      p.author_id     as author_id,
      p.content       as content,
      p.visibility    as visibility,
      p.likes_count   as likes_count,
      p.concern_count as concern_count,
      p.created_at    as created_at
    from public.posts p
    where p.author_id = p_user_id
    order by p.created_at desc
    limit v_limit
  ) t;

  return coalesce(v_result, '[]'::json);
end;
$fn$;

grant execute on function public.admin_user_posts(uuid, int) to authenticated;

-- ------------------------------------------------------------
-- 2b) admin_all_posts — 全投稿一覧 (author_id + nickname 込み, 本文検索可)
-- ------------------------------------------------------------
-- 旧: posts を .select('id, author_id, ...') 直読 + profiles から nickname を N+1。
--     admin/posts ブラウズ tab (fetchAllPosts) 用。author_id 列 SELECT に依存するので
--     definer 化し、nickname も join 済で返す。
create or replace function public.admin_all_posts(
  p_limit  int  default 100,
  p_search text default null
)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_limit  int;
  v_result json;
begin
  if not is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

  select coalesce(
           json_agg(t order by t.created_at desc),
           '[]'::json
         )
    into v_result
  from (
    select
      p.id            as id,
      p.author_id     as author_id,
      pr.nickname     as author_nickname,
      p.content       as content,
      p.visibility    as visibility,
      p.likes_count   as likes_count,
      p.concern_count as concern_count,
      p.created_at    as created_at
    from public.posts p
    left join public.profiles pr on pr.id = p.author_id
    where (p_search is null or p_search = '' or p.content ilike '%' || p_search || '%')
    order by p.created_at desc
    limit v_limit
  ) t;

  return coalesce(v_result, '[]'::json);
end;
$fn$;

grant execute on function public.admin_all_posts(int, text) to authenticated;

-- ------------------------------------------------------------
-- 3) admin_post_detail — 投稿 1 件 + 報告者(concern)一覧
-- ------------------------------------------------------------
-- 旧: posts 直読 (author_id) + concerns(user_id) + profiles から nickname を N+1。
--     全て definer 内で完結させ {post, reporters} の JSON を返す。
create or replace function public.admin_post_detail(
  p_post_id uuid
)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_post      json;
  v_reporters json;
begin
  if not is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  select json_build_object(
           'id',            p.id,
           'author_id',     p.author_id,
           'author_nickname', pr.nickname,
           'content',       p.content,
           'visibility',    p.visibility,
           'likes_count',   p.likes_count,
           'concern_count', p.concern_count,
           'created_at',    p.created_at
         )
    into v_post
  from public.posts p
  left join public.profiles pr on pr.id = p.author_id
  where p.id = p_post_id;

  if v_post is null then
    raise exception 'post not found: %', p_post_id;
  end if;

  select coalesce(
           json_agg(
             json_build_object(
               'user_id',    c.user_id,
               'nickname',   pr.nickname,
               'created_at', c.created_at
             )
             order by c.created_at desc
           ),
           '[]'::json
         )
    into v_reporters
  from public.concerns c
  left join public.profiles pr on pr.id = c.user_id
  where c.post_id = p_post_id;

  return json_build_object('post', v_post, 'reporters', coalesce(v_reporters, '[]'::json));
end;
$fn$;

grant execute on function public.admin_post_detail(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) admin_delete_post — author_id を読んで監査ログを残してから投稿を削除
-- ------------------------------------------------------------
-- 旧: client が削除前に posts.author_id / visibility を直読 → moderation_log に記録 →
--     delete していた。author_id 直読が REVOKE で壊れるので、読み・ログ・削除を
--     definer 1 関数に集約する (= client は author_id を pre-read 不要)。
-- moderation_log の shape は 0031 admin_delete_all_user_posts に合わせる
--   (action='delete_post', target_type='post', metadata=jsonb_build_object(...))。
create or replace function public.admin_delete_post(
  p_post_id uuid
)
returns json language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_author_id  uuid;
  v_visibility text;
  v_deleted    int := 0;
begin
  if not is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  -- 削除前に author_id / visibility を読む (削除後は引けない)。
  select p.author_id, p.visibility
    into v_author_id, v_visibility
  from public.posts p
  where p.id = p_post_id;

  if not found then
    -- 既に無い場合は冪等に no-op 扱い (二重削除でも 500 にしない)。
    return json_build_object('deleted', false, 'author_id', null);
  end if;

  insert into public.moderation_log (admin_id, action, target_type, target_id, reason, metadata)
  values (
    auth.uid(), 'delete_post', 'post', p_post_id, 'admin delete post',
    jsonb_build_object('author_id', v_author_id, 'before_visibility', v_visibility)
  );

  delete from public.posts where id = p_post_id;
  get diagnostics v_deleted = row_count;

  return json_build_object('deleted', v_deleted > 0, 'author_id', v_author_id);
end;
$fn$;

grant execute on function public.admin_delete_post(uuid) to authenticated;

-- ------------------------------------------------------------
-- 完了マーカー
-- ------------------------------------------------------------
select '0128_admin_author_rpcs 完了: admin_reported_posts / admin_user_posts / admin_all_posts / admin_post_detail / admin_delete_post (全て is_admin() gate + security definer)' as result;
