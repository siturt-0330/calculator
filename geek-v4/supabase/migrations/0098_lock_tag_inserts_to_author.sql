-- ============================================================
-- 0098_lock_tag_inserts_to_author.sql
-- post_added_tags の INSERT / DELETE を「投稿者のみ」に制限
-- ============================================================
-- 背景:
--   0004 で `post_added_tags` を導入したとき、INSERT policy は
--     with check (auth.uid() = added_by)
--   だった。これは「自分名義で追加していること」だけしか check していない
--   ため、 *他人の post に対して* 誰でもタグを追加できる community tagging
--   状態だった (delete も added_by 本人なら可能なので、自分が追加した
--   タグだけ自分で消す形だが、結果として post 作者の意図に反するタグが
--   ぶら下がる)。
--
--   ユーザー要望: 「周りの人がタグを追加できないように」
--   → 投稿者 (posts.author_id) 以外は INSERT / DELETE 不可にする。
--
-- 設計判断:
--   * 既存 migration は編集禁止 (idempotency 維持)。新規 0098 のみ。
--   * 冪等: to_regclass で table 存在チェック、drop policy if exists。
--   * SELECT policy は 0082 の `post_added_tags_read` がすでに
--     親 post 可視性を考慮しているのでこの migration では触らない。
--   * service_role / SECURITY DEFINER 経由 (例えば post 作成 trigger や
--     Edge Function の admin 経路) は RLS bypass されるため、引き続き
--     管理用途で書き込める。これは想定通り。
--   * post_tags table はこのリポジトリには存在しない (タグは
--     posts.tag_names text[] に集約)。to_regclass で skip ガードを
--     入れておくことで「将来 post_tags を導入した場合にも同じロジックが
--     適用されるよう」コメントとして残すが、本 migration では table が
--     無いので NOOP になる。
--   * 既存の `_insert` / `_delete` policy 名はクォート付き複合語なので
--     drop は両クォート / 無クォート両方試す形にする (PostgreSQL は
--     `"post_added_tags_insert"` と `post_added_tags_insert` を同一視
--     するが、drop policy if exists は安全に冪等なのでそのまま OK)。
-- ============================================================

-- ------------------------------------------------------------
-- post_added_tags: 投稿者のみ INSERT / DELETE 可
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.post_added_tags') is null then
    raise notice '0098: skip post_added_tags — table not found';
    return;
  end if;

  -- 既存の INSERT / DELETE policy を削除 (0004 で作られたもの)
  execute 'drop policy if exists "post_added_tags_insert" on public.post_added_tags';
  execute 'drop policy if exists "post_added_tags_delete" on public.post_added_tags';
  -- 過去に同等の名前で作られていた場合も保険で drop
  execute 'drop policy if exists "pat_insert_any"         on public.post_added_tags';
  execute 'drop policy if exists "pat_insert"             on public.post_added_tags';
  execute 'drop policy if exists "pat_insert_author_only" on public.post_added_tags';
  execute 'drop policy if exists "pat_delete_author_only" on public.post_added_tags';

  -- INSERT: 投稿者本人だけ。added_by は自分自身でなければならない (なりすまし禁止)。
  execute $POLICY$
    create policy "post_added_tags_insert" on public.post_added_tags
      for insert
      with check (
        auth.uid() = added_by
        and auth.uid() = (
          select p.author_id
          from public.posts p
          where p.id = post_added_tags.post_id
        )
      )
  $POLICY$;

  -- DELETE: 投稿者本人だけ。added_by が自分 (= 0004 と同じ意味) でも、
  -- もはや他人がタグを追加するルートを断つので「投稿者 = added_by」が
  -- ほぼ一意。冗長だが post 作者であることを明示する形で書く。
  execute $POLICY$
    create policy "post_added_tags_delete" on public.post_added_tags
      for delete
      using (
        auth.uid() = (
          select p.author_id
          from public.posts p
          where p.id = post_added_tags.post_id
        )
      )
  $POLICY$;
end $$;

-- ------------------------------------------------------------
-- post_tags: このリポジトリでは現在未導入 (posts.tag_names text[] に集約)。
-- 将来導入した場合に備えて同等のロジックを do block で先回りしておく。
-- table が無ければ NOOP。
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.post_tags') is null then
    raise notice '0098: skip post_tags — table not found (tag_names text[] に集約済み)';
    return;
  end if;

  execute 'drop policy if exists "post_tags_insert"             on public.post_tags';
  execute 'drop policy if exists "post_tags_delete"             on public.post_tags';
  execute 'drop policy if exists "post_tags_insert_any"         on public.post_tags';
  execute 'drop policy if exists "post_tags_insert_author_only" on public.post_tags';
  execute 'drop policy if exists "post_tags_delete_author_only" on public.post_tags';

  execute $POLICY$
    create policy "post_tags_insert" on public.post_tags
      for insert
      with check (
        auth.uid() = (
          select p.author_id
          from public.posts p
          where p.id = post_tags.post_id
        )
      )
  $POLICY$;

  execute $POLICY$
    create policy "post_tags_delete" on public.post_tags
      for delete
      using (
        auth.uid() = (
          select p.author_id
          from public.posts p
          where p.id = post_tags.post_id
        )
      )
  $POLICY$;
end $$;

-- ============================================================
-- 適用確認 note
-- ============================================================
select '0098_lock_tag_inserts_to_author 完了 — post_added_tags の INSERT/DELETE を post 作者本人のみに制限 (post_tags は table 無し→NOOP)' as note;
