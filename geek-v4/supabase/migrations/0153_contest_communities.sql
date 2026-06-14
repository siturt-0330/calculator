-- =============================================================================
-- 0153_contest_communities.sql — ② コンテストコミュニティ(入場ゲート型) ★未適用ドラフト
-- -----------------------------------------------------------------------------
-- 「コンテストに答える = 専用コミュへの入場資格」。モデル = 専用コミュ自動生成。
-- 設計: Obsidian「コンテスト機能 ② コンテストコミュニティ設計」。0151+0152 の上に積む。
-- 砦: メンバー=「参加した」は出る(入場バッジ=設計通り)が、予想内容は self/admin のまま秘匿。
--     ゲート判定は has_answered_contest(自分の行の存在確認)だけ=他人の票も参加可否も覗けない。
-- ★ 投票 ≠ 自動入会。castVote は community_members に触れない。「参加する」が明示 insert する時だけ
--    本ゲートを通る(作成者は handle_new_community で owner 自動 join=ゲート外)。
-- 既存 join(open直join / request承認 / invite)は壊さない: _self_open ポリシーに AND 条件を足すだけ。
-- 依存: communities / community_members / community_bans / handle_new_community(0017) /
--       is_community_owner(0068) / profiles.account_state(0006) / contests・contest_predictions(0151)。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. communities.entry_contest_id — 入口コンテスト (null=非ゲート / not null=ゲート型)
--    ★ on delete set null: contests.community_id は communities へ cascade なので、
--      restrict にすると「コミュ削除→contest cascade→entry_contest_id restrict」で循環 deadlock。
--      set null なら contest 消滅でコミュが非ゲート化(=open join)に degrade するだけで安全。
-- -----------------------------------------------------------------------------
alter table public.communities
  add column if not exists entry_contest_id uuid references public.contests(id) on delete set null;
create index if not exists idx_communities_entry_contest
  on public.communities(entry_contest_id) where entry_contest_id is not null;

-- -----------------------------------------------------------------------------
-- 2. has_answered_contest(uuid) — 自分が入口コンテストに答えたか (self-check・票内容は読まない)
-- -----------------------------------------------------------------------------
create or replace function public.has_answered_contest(p_contest_id uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.contest_predictions
    where contest_id = p_contest_id and user_id = auth.uid()
  );
$$;
revoke all on function public.has_answered_contest(uuid) from public;
grant execute on function public.has_answered_contest(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. get_contest_join_state(uuid) — コンテスト詳細の「参加する」出し分け用
--    { is_entry, community_id, answered, is_member }
-- -----------------------------------------------------------------------------
create or replace function public.get_contest_join_state(p_contest_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare v_cid uuid; v_entry uuid;
begin
  select community_id into v_cid from public.contests where id = p_contest_id;
  if v_cid is null then return jsonb_build_object('is_entry', false); end if;
  select entry_contest_id into v_entry from public.communities where id = v_cid;
  return jsonb_build_object(
    'is_entry', (v_entry is not distinct from p_contest_id),
    'community_id', v_cid,
    'answered', exists (select 1 from public.contest_predictions where contest_id = p_contest_id and user_id = auth.uid()),
    'is_member', exists (select 1 from public.community_members where community_id = v_cid and user_id = auth.uid())
  );
end;
$$;
revoke all on function public.get_contest_join_state(uuid) from public;
grant execute on function public.get_contest_join_state(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. create_contest_community(...) — コミュ → contest → link → (作成者は trigger で owner join)
--    を 1 トランザクションで原子的に。鶏卵(contests.community_id NOT NULL ⇄ communities.entry_contest_id)を解消。
--    返り値: { community_id, contest_id }
-- -----------------------------------------------------------------------------
create or replace function public.create_contest_community(
  p_community_name   text,
  p_icon_emoji       text,
  p_community_desc    text,
  p_title            text,
  p_description      text,
  p_scoring          text,
  p_input_kind       text,
  p_has_submission   boolean,
  p_has_eval_phase   boolean,
  p_lock_at          timestamptz,
  p_eval_unlock_at   timestamptz,
  p_result_at        timestamptz,
  p_options          jsonb       -- [{label, media_url, media_type}] (0154 でメディア対応)
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_cid uuid; v_contest uuid; v_opt jsonb; i int := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  -- BAN ガード(suspended/warned は作成不可)
  if exists (select 1 from public.profiles where id = v_uid and account_state in ('suspended','warned')) then
    raise exception 'guard: アカウント制限中のため作成できません' using errcode = '42501';
  end if;

  -- 1) community(open 可視・ゲートは後で付与)。handle_new_community が作成者を owner として自動 join。
  insert into public.communities(name, description, icon_emoji, visibility, created_by)
  values (
    left(btrim(p_community_name), 40),
    left(coalesce(p_community_desc, ''), 500),
    coalesce(nullif(btrim(p_icon_emoji), ''), '🏆'),
    'open', v_uid
  )
  returning id into v_cid;

  -- 2) contest(この新コミュに属する)
  insert into public.contests(
    community_id, author_id, title, description, scoring, input_kind,
    has_submission, has_eval_phase, lock_at, eval_unlock_at, result_at
  )
  values (
    v_cid, v_uid, left(btrim(p_title), 60),
    nullif(left(coalesce(p_description, ''), 600), ''),
    p_scoring, p_input_kind, p_has_submission, p_has_eval_phase,
    p_lock_at, case when p_has_eval_phase then p_eval_unlock_at else null end, p_result_at
  )
  returning id into v_contest;

  -- 3) link(これで入口ゲートが有効化)
  update public.communities set entry_contest_id = v_contest where id = v_cid;

  -- 4) curated 選択肢(prediction / poll)。label か media_url のどちらかがあれば1件。
  if p_options is not null and jsonb_typeof(p_options) = 'array' then
    for v_opt in select value from jsonb_array_elements(p_options) loop
      if length(btrim(coalesce(v_opt->>'label',''))) > 0 or (v_opt->>'media_url') is not null then
        insert into public.contest_options(contest_id, ordinal, label, kind, author_id, media_url, media_type)
        values (
          v_contest, i, left(btrim(coalesce(v_opt->>'label','')), 80), 'curated', v_uid,
          v_opt->>'media_url',
          case when v_opt->>'media_type' in ('image','video') then v_opt->>'media_type' else null end
        );
        i := i + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('community_id', v_cid, 'contest_id', v_contest);
end;
$$;
revoke all on function public.create_contest_community(text,text,text,text,text,text,text,boolean,boolean,timestamptz,timestamptz,timestamptz,jsonb) from public;
grant execute on function public.create_contest_community(text,text,text,text,text,text,text,boolean,boolean,timestamptz,timestamptz,timestamptz,jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. 入会ゲート: community_members_insert_self_open を「ゲート型は答えた人だけ」に拡張
--    ★ 0068 の現行ポリシー(open可視 + 未BAN)を忠実に再現し、AND で入口条件を追加するだけ。
--      非ゲート(entry_contest_id is null)コミュの open join は従来どおり。
--      作成者の owner join は handle_new_community(DEFINER) 経由なので本ポリシーを通らない。
-- -----------------------------------------------------------------------------
drop policy if exists "community_members_insert_self_open" on public.community_members;
create policy "community_members_insert_self_open" on public.community_members
  for insert with check (
    user_id = auth.uid()
    and community_id in (select id from public.communities where visibility = 'open')
    and not exists (
      select 1 from public.community_bans b
      where b.community_id = community_members.community_id and b.user_id = auth.uid()
    )
    -- ★ 0153: ゲート型(entry_contest_id not null)は入口コンテストに答えていること
    and (
      (select c.entry_contest_id from public.communities c where c.id = community_members.community_id) is null
      or public.has_answered_contest(
           (select c.entry_contest_id from public.communities c where c.id = community_members.community_id))
    )
  );

-- -----------------------------------------------------------------------------
-- 6. ★ join_community_by_id にも入口ゲートを追加(実 join 経路)
--    joinCommunity は本 DEFINER RPC を叩く。DEFINER は RLS を bypass するので §5 だけでは
--    素通りする → ここに contest_gate を入れるのが「効く」ゲート。§5 は defense-in-depth。
--    ★ 0026 の現行実装を忠実に再現し、open 分岐に「ゲート型は答えた人だけ」を足すだけ。
-- -----------------------------------------------------------------------------
create or replace function public.join_community_by_id(c_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_visibility text; v_entry uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using
      message = 'ログイン情報を確認できませんでした。再度ログインしてください。';
  end if;
  select visibility, entry_contest_id into v_visibility, v_entry from public.communities where id = c_id;
  if v_visibility is null then
    raise exception 'community_not_found' using message = 'コミュニティが見つかりません。';
  end if;
  if v_visibility = 'open' then
    -- ★ 0153: ゲート型(entry_contest_id not null)は入口コンテストに答えていること。
    --    投票≠自動入会: castVote はここを呼ばない。「参加する」ボタンが本 RPC を明示的に叩く時だけ通る。
    if v_entry is not null and not public.has_answered_contest(v_entry) then
      raise exception 'contest_gate' using
        message = 'このコミュニティは、コンテストに答えると参加できます。';
    end if;
    insert into public.community_members(community_id, user_id, role)
    values (c_id, auth.uid(), 'member')
    on conflict (community_id, user_id) do nothing;
  elsif v_visibility = 'invite' then
    raise exception 'invite_only' using
      message = 'このコミュニティは招待制です。招待リンクから参加してください。';
  else
    raise exception 'requires_approval' using
      message = 'このコミュニティは参加申請が必要です。';
  end if;
end;
$$;

-- =============================================================================
-- 適用後の確認(verify_contest_migration.sql に追記推奨):
--   - communities に entry_contest_id 列がある
--   - has_answered_contest / get_contest_join_state / create_contest_community が存在し
--     authenticated に execute、public/anon には無い
--   - community_members_insert_self_open ポリシーに entry_contest_id 条件が入っている
-- ★ 0151→0152 同様、適用後に砦の敵対的再監査を回す
--   (入会ゲートの RLS×grant / has_answered の self-only / create RPC の原子性・account_state /
--    メンバーリスト相関=「参加した事実」までが許容で予想内容は秘匿、を確認)。
-- ロールバックは新 migration で。本ファイルは編集しない。
-- =============================================================================
select '0153_contest_communities 完了 — entry_contest_id + has_answered_contest + get_contest_join_state + create_contest_community + 入会ゲート拡張' as note;
