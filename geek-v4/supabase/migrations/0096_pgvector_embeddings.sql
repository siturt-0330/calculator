-- ============================================================
-- 0096_pgvector_embeddings.sql — pgvector 導入 + semantic 検索 基盤
-- ============================================================
-- 目的:
--   将来の Geek 検索 v4 で semantic (= 真の embedding マージ) 検索を
--   実現するための SQL 基盤を作る。
--
--   ここでは "即時に効かせない" 設計とし、以下のみ整備する:
--     1. pgvector extension の確保 (Supabase の標準環境で利用可)
--     2. post 単位の embedding を upsert / 保存する table
--     3. ANN 検索用 index (HNSW、失敗時は ivfflat に fallback)
--     4. cosine similarity を返す RPC (semantic_search_posts)
--     5. 新規 / 編集 post を embedding 生成 queue へ積む table + trigger
--     6. Edge function (service_role) が batch で queue を消化するための RPC
--     7. embedding 計算結果を保存 + queue 削除する RPC
--
--   検索 v4 では即時には使わないが、Edge function (例: HuggingFace
--   Inference API / 自前 embedder) を別途 deploy したタイミングで
--   この基盤に対して書き込み → ANN 検索で text relevance を強化する。
--
-- スキーマ前提 (既存 migration 編集禁止):
--   posts.id      uuid pk                  (0001)
--   posts.title   text nullable            (0075)
--   posts.content text not null            (0001)
--
-- 設計判断:
--   * すべて create [or replace] / if not exists / drop ... if exists で
--     冪等。何度流しても OK。
--   * SECURITY DEFINER の関数は search_path = pg_catalog, public で
--     lockdown (0083 / 0085 / 0086 / 0089 と同じスタイル — search_path
--     injection 対策)。
--   * RLS:
--       post_embeddings  → select は誰でも (= public な fact)、
--                          write は service_role/admin のみ
--       embedding_queue  → select は誰でも (queue 深度 monitoring 用)、
--                          write は service_role/admin のみ
--     直接 INSERT/UPDATE は通常 RPC 経由なので、policy で write 拒否し
--     SECURITY DEFINER RPC からだけ書ける形にする。
--   * embedding 次元は 384 (sentence-transformers の MiniLM 系)。
--     dim が変わる model に切り替える際は新 migration で table 拡張する。
--   * HNSW が利用不可な pgvector バージョン (< 0.5) の場合は ivfflat に
--     fallback する DO ブロックを置く。
--   * vector extension が Supabase 既定環境で利用不可なら、
--     create extension if not exists のまま skip され、本 migration の
--     残りも DO ブロック内で表存在チェックして skip する。
--     → 全体として idempotent / safe-on-skip。
--
-- Edge function 連携の道筋 (将来):
--   1. cron-like Edge function を 1〜5 分毎に起動
--   2. service_role で dequeue_embedding_batch(50) を呼ぶ
--   3. 取得した (title, content) を embedding 生成 API へ送信
--   4. 各結果について record_post_embedding(post_id, embedding) を呼ぶ
--   5. post_embeddings に upsert / embedding_queue から自動削除
--   6. クライアントは semantic_search_posts(query_embedding, ...) を
--      呼んで類似 post を取得 (将来の検索 v4)
-- ============================================================

-- ============================================================
-- 0. 前提 extension (idempotent, Supabase に無ければ no-op で残り skip)
-- ============================================================
create extension if not exists vector;

-- 利用可能か検査するためのフラグ用 DO。
-- vector extension が無い環境ではこれ以降の table / index / RPC 作成を
-- 全て skip し、NOTICE を出す。
do $$
declare
  v_has_vector boolean;
begin
  select exists(
    select 1 from pg_extension where extname = 'vector'
  ) into v_has_vector;

  if not v_has_vector then
    raise notice '0096 skipped: pgvector extension が利用不可な環境です';
    return;
  end if;
end$$;

-- ============================================================
-- 1. post_embeddings — table
-- ============================================================
-- post 1 件につき 1 行。embedding は将来 model 更新時に上書きされる。
-- source は「何を埋め込んだか」をログる: title のみ / title+先頭 500 字 /
-- 本文全件。検索クエリ側の戦略を変えた際に検証用に残す。
-- ============================================================
do $$
begin
  if exists(select 1 from pg_extension where extname = 'vector') then
    execute $ddl$
      create table if not exists public.post_embeddings (
        post_id       uuid primary key references public.posts(id) on delete cascade,
        embedding     vector(384) not null,
        model_name    text not null default 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
        model_version text not null default 'v1',
        generated_at  timestamptz not null default now(),
        source        text not null default 'title_content_first_500'
                      check (source in ('title_only', 'title_content_first_500', 'full'))
      )
    $ddl$;
  end if;
end$$;

comment on table public.post_embeddings is
  'post 単位の埋め込み (semantic 検索基盤)。Edge function が service_role で書く。';

-- ============================================================
-- 2. ANN index — HNSW preferred, fallback to ivfflat
-- ============================================================
-- HNSW (vector_cosine_ops) は pgvector 0.5+ で利用可能。
-- 失敗した場合 (古い pgvector) は ivfflat (lists=100) に fallback。
-- どちらも create if not exists 相当の保護を DO ブロックで明示する。
-- ============================================================
do $$
declare
  v_has_table boolean;
  v_has_hnsw_idx boolean;
  v_has_ivf_idx boolean;
begin
  if not exists(select 1 from pg_extension where extname = 'vector') then
    return;
  end if;

  select to_regclass('public.post_embeddings') is not null into v_has_table;
  if not v_has_table then
    return;
  end if;

  -- 既存の HNSW index があるか
  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'post_embeddings_hnsw'
  ) into v_has_hnsw_idx;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'post_embeddings_ivfflat'
  ) into v_has_ivf_idx;

  if not v_has_hnsw_idx and not v_has_ivf_idx then
    begin
      execute $ddl$
        create index if not exists post_embeddings_hnsw
          on public.post_embeddings
          using hnsw (embedding vector_cosine_ops)
      $ddl$;
    exception when others then
      raise notice '0096: HNSW index 作成失敗 — ivfflat にフォールバック (% / %)', sqlstate, sqlerrm;
      begin
        execute $ddl$
          create index if not exists post_embeddings_ivfflat
            on public.post_embeddings
            using ivfflat (embedding vector_cosine_ops)
            with (lists = 100)
        $ddl$;
      exception when others then
        raise notice '0096: ivfflat index 作成も失敗 — index 無しで継続 (% / %)', sqlstate, sqlerrm;
      end;
    end;
  end if;
end$$;

-- model_name + generated_at の補助 index (analytics / ローテーション用)
create index if not exists post_embeddings_model_idx
  on public.post_embeddings(model_name, model_version);
create index if not exists post_embeddings_generated_idx
  on public.post_embeddings(generated_at desc);

-- ============================================================
-- 3. embedding_queue — table
-- ============================================================
-- 新規 / 更新 post を Edge function が消化するための queue。
-- post_id を pk にして同 post の重複 enqueue を自然に防ぐ。
-- attempts は Edge function 側で失敗を観測するためのカウンタ。
-- ============================================================
create table if not exists public.embedding_queue (
  post_id     uuid primary key references public.posts(id) on delete cascade,
  enqueued_at timestamptz not null default now(),
  attempts    int not null default 0
);

create index if not exists embedding_queue_enqueued_idx
  on public.embedding_queue(enqueued_at asc);

comment on table public.embedding_queue is
  '新規/更新 post の embedding 生成 queue (Edge function が service_role で消化)';

-- ============================================================
-- 4. RLS
-- ============================================================
-- post_embeddings:
--   read = 誰でも (= 検索結果の構成要素として透明性確保)
--   write = service_role / admin (RPC 経由のみ。policy で他を拒否)
-- embedding_queue:
--   read = 誰でも (queue 深度 monitor)
--   write = service_role / admin
-- ============================================================
do $$
begin
  if to_regclass('public.post_embeddings') is not null then
    execute 'alter table public.post_embeddings enable row level security';
  end if;
end$$;

drop policy if exists "post_embeddings_read" on public.post_embeddings;
do $$
begin
  if to_regclass('public.post_embeddings') is not null then
    execute $sql$
      create policy "post_embeddings_read"
        on public.post_embeddings
        for select using (true)
    $sql$;
  end if;
end$$;

drop policy if exists "post_embeddings_admin_write" on public.post_embeddings;
do $$
begin
  if to_regclass('public.post_embeddings') is not null then
    execute $sql$
      create policy "post_embeddings_admin_write"
        on public.post_embeddings
        for all
        using (public.is_admin())
        with check (public.is_admin())
    $sql$;
  end if;
end$$;

-- embedding_queue
alter table public.embedding_queue enable row level security;

drop policy if exists "embedding_queue_read" on public.embedding_queue;
create policy "embedding_queue_read"
  on public.embedding_queue
  for select
  using (true);

drop policy if exists "embedding_queue_admin_write" on public.embedding_queue;
create policy "embedding_queue_admin_write"
  on public.embedding_queue
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- 直接 INSERT/UPDATE/DELETE は通常クライアントから拒否し、
-- service_role (RLS bypass) / SECURITY DEFINER RPC からのみ書く。
do $$
begin
  if to_regclass('public.post_embeddings') is not null then
    execute 'grant select on public.post_embeddings to anon, authenticated';
    execute 'revoke insert, update, delete on public.post_embeddings from anon, authenticated';
  end if;
end$$;

grant select on public.embedding_queue to anon, authenticated;
revoke insert, update, delete on public.embedding_queue from anon, authenticated;

-- ============================================================
-- 5. RPC: semantic_search_posts(query_embedding, limit, min_similarity)
-- ============================================================
-- cosine similarity = 1 - (embedding <=> p_query_embedding)
-- 戻り値は (post_id, similarity) でスコア降順。
-- p_min_similarity 以下は捨てる (default 0.5)。
-- pgvector が無い環境では空集合を返す (= safe-on-skip)。
-- ============================================================
do $$
begin
  if not exists(select 1 from pg_extension where extname = 'vector') then
    -- pgvector 不在環境では dummy 関数を残しておく (呼び出し側が壊れない)
    execute $fn$
      drop function if exists public.semantic_search_posts(text, int, numeric);
    $fn$;
    execute $fn$
      create or replace function public.semantic_search_posts(
        p_query_embedding text,
        p_limit int default 20,
        p_min_similarity numeric default 0.5
      )
      returns table(post_id uuid, similarity numeric)
      language plpgsql
      stable
      security definer
      set search_path = pg_catalog, public
      as $body$
      begin
        return;
      end;
      $body$
    $fn$;
    return;
  end if;

  -- 通常パス: vector(384) を引数に取る本来の RPC
  execute $fn$
    drop function if exists public.semantic_search_posts(vector, int, numeric);
  $fn$;

  execute $fn$
    create or replace function public.semantic_search_posts(
      p_query_embedding vector(384),
      p_limit int default 20,
      p_min_similarity numeric default 0.5
    )
    returns table(post_id uuid, similarity numeric)
    language plpgsql
    stable
    security definer
    set search_path = pg_catalog, public
    as $body$
    declare
      v_limit int := least(coalesce(p_limit, 20), 200);
      v_min numeric := greatest(coalesce(p_min_similarity, 0.5), 0);
    begin
      if p_query_embedding is null then
        return;
      end if;

      return query
      select
        pe.post_id,
        (1 - (pe.embedding <=> p_query_embedding))::numeric as similarity
      from public.post_embeddings pe
      where (1 - (pe.embedding <=> p_query_embedding)) > v_min
      order by pe.embedding <=> p_query_embedding asc
      limit v_limit;
    end;
    $body$
  $fn$;
end$$;

-- 実行権限: 認証済ユーザー / anon にも実行を許可 (RLS bypass されないよう
-- SECURITY DEFINER 内でも RLS-friendly な select のみ)。
do $$
begin
  if exists(select 1 from pg_extension where extname = 'vector') then
    execute 'revoke all on function public.semantic_search_posts(vector, int, numeric) from public';
    execute 'grant execute on function public.semantic_search_posts(vector, int, numeric) to anon, authenticated';
  else
    execute 'revoke all on function public.semantic_search_posts(text, int, numeric) from public';
    execute 'grant execute on function public.semantic_search_posts(text, int, numeric) to anon, authenticated';
  end if;
end$$;

-- ============================================================
-- 6. trigger function: enqueue_post_embedding
-- ============================================================
-- posts INSERT または UPDATE OF (title, content) で
-- embedding_queue に on conflict do nothing で積む。
-- SECURITY DEFINER (= post owner の権限差を吸収)。
-- ============================================================
create or replace function public.enqueue_post_embedding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- update のときは title / content が実際に変わったときだけ enqueue
  if tg_op = 'UPDATE' then
    if (coalesce(new.title, '') = coalesce(old.title, ''))
       and (coalesce(new.content, '') = coalesce(old.content, '')) then
      return new;
    end if;
  end if;

  insert into public.embedding_queue (post_id, enqueued_at, attempts)
  values (new.id, now(), 0)
  on conflict (post_id) do update
    set enqueued_at = now(),
        attempts = 0;

  return new;
end;
$$;

revoke all on function public.enqueue_post_embedding() from public;

-- ============================================================
-- 7. trigger on posts
-- ============================================================
-- after insert or update of (title, content) で発火。
-- 冪等のため drop trigger if exists で先に消す。
-- ============================================================
drop trigger if exists enqueue_post_embedding_trg on public.posts;
create trigger enqueue_post_embedding_trg
  after insert or update of title, content on public.posts
  for each row execute function public.enqueue_post_embedding();

-- ============================================================
-- 8. RPC: dequeue_embedding_batch(limit) — admin only
-- ============================================================
-- embedding_queue から FIFO で N 件取り出し、attempts を +1 する。
-- 行ロック (for update skip locked) で並列 worker でも安全。
-- (post_id, title, content) を返し、Edge function 側で embedding を計算。
-- 計算成功後は record_post_embedding(...) を呼ぶ (= queue から削除)。
-- ============================================================
drop function if exists public.dequeue_embedding_batch(int);
create or replace function public.dequeue_embedding_batch(
  p_limit int default 50
)
returns table(post_id uuid, title text, content text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 500);
begin
  -- admin / service_role 以外は弾く (service_role は is_admin() でも true 相当に
  -- 振る舞うが、安全側として明示 check)。
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  with picked as (
    select eq.post_id
    from public.embedding_queue eq
    order by eq.enqueued_at asc
    for update skip locked
    limit v_limit
  ),
  bumped as (
    update public.embedding_queue eq
    set attempts = eq.attempts + 1
    where eq.post_id in (select picked.post_id from picked)
    returning eq.post_id
  )
  select b.post_id, p.title, p.content
  from bumped b
  join public.posts p on p.id = b.post_id;
end;
$$;

revoke all on function public.dequeue_embedding_batch(int) from public;
grant execute on function public.dequeue_embedding_batch(int) to authenticated;

comment on function public.dequeue_embedding_batch(int) is
  'admin/service_role: embedding_queue から最大 N 件取り出し attempts を +1';

-- ============================================================
-- 9. RPC: record_post_embedding(...)
-- ============================================================
-- Edge function (service_role) が embedding 計算結果を保存するための RPC。
-- post_embeddings に upsert し、embedding_queue から該当行を削除する。
-- p_model_name が null なら既存 default (MiniLM L12 v2) を維持。
-- ============================================================
do $$
begin
  if exists(select 1 from pg_extension where extname = 'vector') then
    execute $fn$
      drop function if exists public.record_post_embedding(uuid, vector, text, text);
    $fn$;

    execute $fn$
      create or replace function public.record_post_embedding(
        p_post_id uuid,
        p_embedding vector(384),
        p_model_name text default null,
        p_source text default 'title_content_first_500'
      )
      returns void
      language plpgsql
      volatile
      security definer
      set search_path = pg_catalog, public
      as $body$
      begin
        if not public.is_admin() then
          raise exception 'admin only';
        end if;

        if p_post_id is null or p_embedding is null then
          raise exception 'p_post_id / p_embedding must not be null';
        end if;

        if p_source not in ('title_only', 'title_content_first_500', 'full') then
          raise exception 'invalid source: %', p_source;
        end if;

        insert into public.post_embeddings as pe (
          post_id, embedding, model_name, model_version, generated_at, source
        )
        values (
          p_post_id,
          p_embedding,
          coalesce(p_model_name, 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'),
          'v1',
          now(),
          p_source
        )
        on conflict (post_id) do update
          set embedding    = excluded.embedding,
              model_name   = excluded.model_name,
              model_version= excluded.model_version,
              generated_at = excluded.generated_at,
              source       = excluded.source;

        -- queue から削除 (= 処理済)
        delete from public.embedding_queue where post_id = p_post_id;
      end;
      $body$
    $fn$;

    execute 'revoke all on function public.record_post_embedding(uuid, vector, text, text) from public';
    execute 'grant execute on function public.record_post_embedding(uuid, vector, text, text) to authenticated';
  else
    -- pgvector 不在環境では dummy 関数 (Edge function が壊れない様に)。
    execute $fn$
      drop function if exists public.record_post_embedding(uuid, text, text, text);
    $fn$;

    execute $fn$
      create or replace function public.record_post_embedding(
        p_post_id uuid,
        p_embedding text,
        p_model_name text default null,
        p_source text default 'title_content_first_500'
      )
      returns void
      language plpgsql
      volatile
      security definer
      set search_path = pg_catalog, public
      as $body$
      begin
        raise notice 'record_post_embedding: pgvector 不在環境のため no-op';
      end;
      $body$
    $fn$;
    execute 'revoke all on function public.record_post_embedding(uuid, text, text, text) from public';
    execute 'grant execute on function public.record_post_embedding(uuid, text, text, text) to authenticated';
  end if;
end$$;

-- ============================================================
-- 10. ANALYZE
-- ============================================================
do $$
begin
  if to_regclass('public.post_embeddings') is not null then
    execute 'analyze public.post_embeddings';
  end if;
end$$;
analyze public.embedding_queue;

-- ============================================================
-- 完了通知
-- ============================================================
select '0096_pgvector_embeddings 完了 — vector extension + post_embeddings (HNSW/ivfflat fallback) + embedding_queue + trigger + dequeue/record RPC (Edge function 連携基盤)' as note;
