-- ============================================================
-- 0077_fix_delete_account.sql
-- ============================================================
-- GDPR Right to Erasure ブロッカー修正 (Audit A#5 + B#5)
--
-- 背景:
--   0039 / 0040 で実装された public.delete_account() が、いくつかの
--   テーブルで実在しないカラム名を参照しており、最初に当たった行で
--   "column does not exist" 例外 → トランザクション全体が abort、
--   auth.users の削除まで到達しなかった。
--   結果: 「アカウント削除」ボタンが silently 失敗し、GDPR 義務違反。
--
-- 実カラム名の確認:
--   - user_stamps           : creator_id   (0009_text_stamps.sql L39)
--                             → 0040 では user_id と参照していた (BUG)
--   - community_spots       : created_by   (0023 L101)
--                             → 0040 では creator_id と参照していた (BUG)
--   - community_events      : created_by   (0023 L145)
--                             → 0040 では creator_id と参照していた (BUG)
--   - community_calendar_events : created_by (0032 L359)
--                             → 0040 では creator_id と参照していた (BUG)
--   - community_map_locations : created_by (0032 L399)
--                             → 0040 では creator_id と参照していた (BUG)
--   - community_qna_documents : created_by (0032 L273)
--                             → 0040 では creator_id と参照していた (BUG)
--   - community_qna_questions : asked_by  (0032 L317, NOT NULL)
--                             → 0040 では UPDATE set null だが asked_by は
--                               NOT NULL 制約のため失敗。DELETE に変更。
--
-- 変更点 (0040 比):
--   1. user_stamps           : delete where creator_id = uid  (NOT user_id)
--   2. community_spots / events / calendar_events / map_locations /
--      qna_documents         : update set created_by = null   (NOT creator_id)
--   3. community_qna_questions : delete where asked_by = uid
--      (asked_by は NOT NULL なので update set null は失敗する)
--
-- 不変点 (これらは正しいので 0040 のまま):
--   - community_stamps.creator_id (0040 L34 で正しく creator_id 定義)
--   - community_invites.created_by
--   - その他 user_id / author_id / id 系
--
-- 設計上の注意:
--   - SECURITY DEFINER + set search_path = public, pg_temp, auth を維持
--   - per-table EXCEPTION ハンドラで「ある 1 テーブルが失敗しても他は続行」
--     (CASCADE 漏れや schema drift があっても auth.users の削除まで到達する)
--   - 公式コミュ財産 (spots / events / docs 等) は created_by = null で残す
--     方針を維持。creator が居なくなっても knowledge は他メンバーが使う。
--   - Idempotent: CREATE OR REPLACE FUNCTION + GRANT EXECUTE は何度実行しても可
-- ============================================================

do $$
begin
  if to_regclass('auth.users') is null then
    raise notice '0077: skip — auth.users not found';
    return;
  end if;

  create or replace function public.delete_account()
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp, auth
  as $fn$
  declare
    v_user_id uuid := auth.uid();
  begin
    if v_user_id is null then
      raise exception 'not authenticated' using errcode = '28000';
    end if;

    declare
      t text;
      tables text[] := array[
        -- core (delete by user_id / author_id)
        'concerns','likes','saves','bookmarks','reports','comments','post_reactions',
        'community_stamp_reactions',
        'posts','post_communities','post_link_previews',
        -- bbs
        'bbs_replies','bbs_reply_reactions','bbs_threads',
        -- community membership / governance
        'community_members','community_join_requests','community_invites',
        -- community-owned content (preserve via null-out)
        'community_stamps',
        'community_spots','community_events','community_calendar_events',
        'community_map_locations','community_qna_documents',
        -- community Q&A (delete: asked_by has NOT NULL constraint)
        'community_qna_questions',
        -- ads / push / notifications / feedback
        'ad_events','push_subscriptions','notifications','admin_messages',
        'app_feedback','user_stamps','user_liked_tags','user_blocked_tags',
        'tag_subscriptions','official_community_applications',
        -- last: profile
        'profiles'
      ];
    begin
      foreach t in array tables loop
        if to_regclass('public.' || t) is null then continue; end if;
        begin
          if t = 'reports' then
            execute format('delete from public.%I where reporter_id = $1', t) using v_user_id;

          elsif t = 'user_stamps' then
            -- ★ FIX: user_stamps の所有者カラムは creator_id (NOT user_id)
            execute format('delete from public.%I where creator_id = $1', t) using v_user_id;

          elsif t = 'concerns' or t = 'likes' or t = 'saves' or t = 'bookmarks'
             or t = 'community_members' or t = 'community_join_requests'
             or t = 'push_subscriptions'
             or t = 'user_liked_tags' or t = 'user_blocked_tags'
             or t = 'tag_subscriptions' or t = 'ad_events' or t = 'app_feedback'
             or t = 'community_stamp_reactions' then
            execute format('delete from public.%I where user_id = $1', t) using v_user_id;

          elsif t = 'notifications' then
            execute format('delete from public.%I where user_id = $1', t) using v_user_id;

          elsif t = 'admin_messages' then
            execute format('delete from public.%I where recipient_id = $1 or sender_id = $1', t) using v_user_id;

          elsif t = 'post_reactions' or t = 'bbs_reply_reactions' then
            execute format('delete from public.%I where user_id = $1', t) using v_user_id;

          elsif t = 'community_invites' then
            execute format('delete from public.%I where created_by = $1', t) using v_user_id;

          elsif t = 'official_community_applications' then
            execute format('delete from public.%I where applicant_user_id = $1', t) using v_user_id;

          elsif t = 'community_stamps' then
            -- community_stamps の作成者カラムは creator_id (0040 L34)
            -- null 化で残し、コミュ財産として保護
            execute format('update public.%I set creator_id = null where creator_id = $1', t) using v_user_id;

          elsif t = 'community_spots' or t = 'community_events'
             or t = 'community_calendar_events' or t = 'community_map_locations'
             or t = 'community_qna_documents' then
            -- ★ FIX: これら 5 テーブルの作成者カラムは created_by (NOT creator_id)
            -- null 化で残し、コミュ財産として保護
            execute format('update public.%I set created_by = null where created_by = $1', t) using v_user_id;

          elsif t = 'community_qna_questions' then
            -- ★ FIX: asked_by は NOT NULL 制約のため UPDATE set null は不可。
            -- ユーザー固有 (質問は author identity と密接) なので削除する。
            execute format('delete from public.%I where asked_by = $1', t) using v_user_id;

          elsif t = 'comments' or t = 'bbs_replies' or t = 'posts' or t = 'bbs_threads' then
            execute format('delete from public.%I where author_id = $1', t) using v_user_id;

          elsif t = 'post_communities' or t = 'post_link_previews' then
            -- FK cascade に任せる (posts が消えれば付随的に消える)
            continue;

          elsif t = 'profiles' then
            execute format('delete from public.%I where id = $1', t) using v_user_id;
          end if;
        exception when others then
          raise notice 'delete_account: skip % (%)', t, sqlerrm;
        end;
      end loop;
    end;

    -- 最後に auth.users を削除 (SECURITY DEFINER により権限あり)
    begin
      delete from auth.users where id = v_user_id;
    exception when others then
      raise notice 'delete_account: auth.users delete failed: %', sqlerrm;
    end;
  end;
  $fn$;

  -- authenticated ロールに実行権限を付与 (本人のみ自分のアカウントを削除可)
  begin
    execute 'grant execute on function public.delete_account() to authenticated';
  exception when others then null;
  end;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0077_fix_delete_account 完了: user_stamps.creator_id / community_*.created_by / qna_questions DELETE 修正 (GDPR Right to Erasure 復活)' as result;
