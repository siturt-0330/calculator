-- =============================================================================
-- コンテスト機能 migration 適用確認スクリプト (READ-ONLY)
--   0151_contests_skeleton.sql + 0152_contest_audit_fixes.sql の適用状態を検証。
--   Supabase SQL エディタに丸ごと貼って実行。各ブロックが label 付きで PASS/FAIL を返す。
--   書き込みは一切しない (SELECT / 情報スキーマ参照のみ)。pg_cron 未導入時は [7b] をスキップ。
-- =============================================================================

-- #############################################################################
-- ★ ONE-SHOT 統合レポート（これ1本だけ実行すれば全チェックが1つの表で出る）
--   Supabase SQL エディタは複数文だと「最後の文」しか表示しないため、
--   下の per-block 版ではなく、まずこの 1 クエリを実行するのが楽。
--   result 列が全部 PASS なら 0151+0152 完全適用（cron だけは [7] を別途実行）。
-- #############################################################################
with report as (
  -- [1] 6 テーブル + RLS
  select 1 as step, '[1] table+RLS'::text as check_name, t.tname::text as object,
    (case when c.relname is not null and c.relrowsecurity then 'PASS' else 'FAIL' end)::text as result,
    (case when c.relname is null then 'table 不在' when not c.relrowsecurity then 'RLS 無効' else 'ok' end)::text as detail
  from (values ('contests'),('contest_options'),('contest_predictions'),
               ('contest_answers'),('contest_user_titles'),('contest_reports')) as t(tname)
  left join pg_class c on c.relname=t.tname and c.relnamespace='public'::regnamespace and c.relkind='r'

  union all
  -- [2] RLS ポリシー存在
  select 2, '[2] policy', (e.tname||'.'||e.pname)::text,
    (case when p.policyname is not null then 'PASS' else 'FAIL' end)::text,
    coalesce(p.cmd::text,'(missing)')
  from (values
    ('contests','contests_read'),('contests','contests_insert'),('contests','contests_update'),('contests','contests_delete'),
    ('contest_options','co_read'),('contest_options','co_insert'),('contest_options','co_update'),('contest_options','co_delete'),
    ('contest_predictions','cp_read'),('contest_predictions','cp_insert'),('contest_predictions','cp_update'),('contest_predictions','cp_delete'),
    ('contest_answers','ca_none'),
    ('contest_user_titles','cut_read'),('contest_user_titles','cut_write'),
    ('contest_reports','crp_insert'),('contest_reports','crp_read')) as e(tname,pname)
  left join pg_policies p on p.schemaname='public' and p.tablename=e.tname and p.policyname=e.pname

  union all
  -- [3] 関数存在 (is_contest_author = 0152)
  select 3, '[3] function', f.sig::text,
    (case when to_regprocedure(f.sig) is not null then 'PASS' else 'FAIL' end)::text, ''::text
  from (values ('public.confirm_contest_result(uuid, uuid)'),('public.get_contest_result(uuid)'),
               ('public.get_contest_breakdown(uuid)'),('public.report_contest(uuid, text)'),
               ('public.process_due_contest_titles()'),('public.is_contest_author(uuid)')) as f(sig)

  union all
  -- [4] ★EXECUTE 権限 (authenticated は称号バッチ不可=false が正)
  select 4, '[4] EXECUTE', (q.role||' -> '||q.fname)::text,
    (case when has_function_privilege(q.role, to_regprocedure(q.sig), 'EXECUTE') is not distinct from q.expected then 'PASS' else 'FAIL' end)::text,
    ('actual='||coalesce(has_function_privilege(q.role, to_regprocedure(q.sig), 'EXECUTE')::text,'null')||' expected='||q.expected::text)::text
  from (values
    ('authenticated','confirm_contest_result','public.confirm_contest_result(uuid, uuid)', true),
    ('authenticated','get_contest_result',    'public.get_contest_result(uuid)',          true),
    ('authenticated','get_contest_breakdown', 'public.get_contest_breakdown(uuid)',       true),
    ('authenticated','report_contest',        'public.report_contest(uuid, text)',        true),
    ('authenticated','is_contest_author',     'public.is_contest_author(uuid)',           true),
    ('authenticated','process_due_contest_titles','public.process_due_contest_titles()',  false),
    ('service_role','process_due_contest_titles', 'public.process_due_contest_titles()',   true),
    ('anon','get_contest_result',    'public.get_contest_result(uuid)',    true),
    ('anon','get_contest_breakdown', 'public.get_contest_breakdown(uuid)', true)) as q(role,fname,sig,expected)

  union all
  -- [5] トリガ (trg_contest_options_guard_update = 0152)
  select 5, '[5] trigger', (e.tbl||'.'||e.trg)::text,
    (case when tg.tgname is not null then 'PASS' else 'FAIL' end)::text, ''::text
  from (values
    ('contests','zz_enforce_account_state'),('contest_options','zz_enforce_account_state'),
    ('contest_predictions','zz_enforce_account_state'),('contest_reports','zz_enforce_account_state'),
    ('contests','trg_contests_guard_update'),('contest_options','trg_contest_options_guard'),
    ('contest_options','trg_contest_options_guard_update'),
    ('contest_reports','trg_contest_reports_autovoid'),('contest_predictions','trg_contests_after_prediction')) as e(tbl,trg)
  left join pg_trigger tg on tg.tgname=e.trg and tg.tgrelid=('public.'||e.tbl)::regclass and not tg.tgisinternal

  union all
  -- [5b] enforce_account_state_write 前提 (0106)
  select 6, '[5b] dep fn', 'enforce_account_state_write()'::text,
    (case when to_regprocedure('public.enforce_account_state_write()') is not null then 'PASS' else 'WARN' end)::text,
    (case when to_regprocedure('public.enforce_account_state_write()') is not null then 'ok' else '0106 未適用 → zz_enforce は skip 済' end)::text

  union all
  -- [6] profiles.contest_* 4 列
  select 7, '[6] profiles col', e.col::text,
    (case when col.column_name is not null then 'PASS' else 'FAIL' end)::text, coalesce(col.data_type,'')::text
  from (values ('contest_participation_total'),('contest_streak_weeks'),
               ('contest_titles_count'),('contest_last_participation_week')) as e(col)
  left join information_schema.columns col on col.table_schema='public' and col.table_name='profiles' and col.column_name=e.col

  union all
  -- [8a] anon は contest_predictions を読めない
  select 8, '[8a] anon no SELECT pred', 'contest_predictions'::text,
    (case when has_table_privilege('anon','public.contest_predictions','SELECT')=false then 'PASS' else 'FAIL' end)::text, ''::text

  union all
  -- [8c] contest_answers に直アクセス権なし
  select 9, '[8c] answers no grants', r.role::text,
    (case when not has_table_privilege(r.role,'public.contest_answers','SELECT')
           and not has_table_privilege(r.role,'public.contest_answers','INSERT')
           and not has_table_privilege(r.role,'public.contest_answers','UPDATE')
           and not has_table_privilege(r.role,'public.contest_answers','DELETE')
          then 'PASS' else 'FAIL' end)::text, ''::text
  from (values ('anon'),('authenticated')) as r(role)

  union all
  -- [9] ★0152: author_id が anon/authenticated に列 SELECT されていない
  select 10, '[9] author_id not granted', 'contests+contest_options'::text,
    (case when not exists (select 1 from information_schema.role_column_grants
                           where table_schema='public' and table_name in ('contests','contest_options')
                             and column_name='author_id' and privilege_type='SELECT' and grantee in ('anon','authenticated'))
          then 'PASS' else 'FAIL' end)::text,
    coalesce((select string_agg(grantee||':'||table_name, ', ') from information_schema.role_column_grants
              where table_schema='public' and table_name in ('contests','contest_options')
                and column_name='author_id' and privilege_type='SELECT' and grantee in ('anon','authenticated')),
             '0152 未適用なら leak / 適用済なら none')::text

  union all
  -- [9b] ★0152: contests/contest_options に table 全体 SELECT が残っていない
  select 11, '[9b] no table-wide SELECT', 'contests+contest_options'::text,
    (case when not exists (select 1 from information_schema.role_table_grants
                           where table_schema='public' and table_name in ('contests','contest_options')
                             and grantee in ('anon','authenticated') and privilege_type='SELECT')
          then 'PASS' else 'FAIL' end)::text,
    coalesce((select string_agg(grantee||':'||table_name, ', ') from information_schema.role_table_grants
              where table_schema='public' and table_name in ('contests','contest_options')
                and grantee in ('anon','authenticated') and privilege_type='SELECT'), 'none')::text
)
select check_name, object, result, detail from report order by step, object;
-- → result 列に FAIL が無ければ 0151+0152 は完全適用。FAIL があれば object/detail で原因が分かる。
--   ([9]/[9b] が FAIL = 0152 §6 未適用。[5] の *_guard_update が FAIL = 0152 §3 未適用。)
--   cron は pg_cron 依存のため下の [7a]/[7b] を別途実行。

-- #############################################################################
-- 以下は per-block 詳細版（ドリルダウン用。1ブロックずつ選択して実行する）
-- #############################################################################

-- [1] 6 テーブルが存在し RLS 有効か (期待: 6 行とも exists=true / rls_enabled=true)
select '[1] table+RLS' as check, t.tname as object,
  (c.relname is not null) as exists, coalesce(c.relrowsecurity,false) as rls_enabled,
  case when c.relname is not null and c.relrowsecurity then 'PASS' else 'FAIL' end as result
from (values ('contests'),('contest_options'),('contest_predictions'),
             ('contest_answers'),('contest_user_titles'),('contest_reports')) as t(tname)
left join pg_class c on c.relname=t.tname and c.relnamespace='public'::regnamespace and c.relkind='r'
order by t.tname;

-- [2] 期待する RLS ポリシーが存在するか
select '[2] policy exists' as check, e.tname||'.'||e.pname as expected_policy,
  (p.policyname is not null) as exists, p.cmd as cmd,
  case when p.policyname is not null then 'PASS' else 'FAIL' end as result
from (values
  ('contests','contests_read'),('contests','contests_insert'),('contests','contests_update'),('contests','contests_delete'),
  ('contest_options','co_read'),('contest_options','co_insert'),('contest_options','co_update'),('contest_options','co_delete'),
  ('contest_predictions','cp_read'),('contest_predictions','cp_insert'),('contest_predictions','cp_update'),('contest_predictions','cp_delete'),
  ('contest_answers','ca_none'),
  ('contest_user_titles','cut_read'),('contest_user_titles','cut_write'),
  ('contest_reports','crp_insert'),('contest_reports','crp_read')) as e(tname,pname)
left join pg_policies p on p.schemaname='public' and p.tablename=e.tname and p.policyname=e.pname
order by e.tname, e.pname;

-- [3] 6 関数が存在するか (0152 の is_contest_author 含む)
select '[3] function exists' as check, f.sig as object,
  (to_regprocedure(f.sig) is not null) as exists,
  case when to_regprocedure(f.sig) is not null then 'PASS' else 'FAIL' end as result
from (values
  ('public.confirm_contest_result(uuid, uuid)'),
  ('public.get_contest_result(uuid)'),
  ('public.get_contest_breakdown(uuid)'),
  ('public.report_contest(uuid, text)'),
  ('public.process_due_contest_titles()'),
  ('public.is_contest_author(uuid)')) as f(sig)
order by f.sig;

-- [4] ★最重要 EXECUTE 権限: authenticated は称号バッチを叩けてはいけない / service_role は叩ける
select '[4] EXECUTE grant' as check, q.role||' -> '||q.fname as object,
  has_function_privilege(q.role, to_regprocedure(q.sig), 'EXECUTE') as can_execute, q.expected as expected,
  case when has_function_privilege(q.role, to_regprocedure(q.sig), 'EXECUTE')=q.expected then 'PASS' else 'FAIL' end as result
from (values
  ('authenticated','confirm_contest_result','public.confirm_contest_result(uuid, uuid)', true),
  ('authenticated','get_contest_result',    'public.get_contest_result(uuid)',          true),
  ('authenticated','get_contest_breakdown', 'public.get_contest_breakdown(uuid)',       true),
  ('authenticated','report_contest',        'public.report_contest(uuid, text)',        true),
  ('authenticated','is_contest_author',     'public.is_contest_author(uuid)',           true),
  ('authenticated','process_due_contest_titles','public.process_due_contest_titles()',  false),  -- ★false が正(自己付与封じ)
  ('service_role','process_due_contest_titles', 'public.process_due_contest_titles()',   true),
  ('anon','get_contest_result',    'public.get_contest_result(uuid)',    true),
  ('anon','get_contest_breakdown', 'public.get_contest_breakdown(uuid)', true)) as q(role,fname,sig,expected)
order by q.fname, q.role;

-- [5] トリガが貼られているか (0152 の trg_contest_options_guard_update 含む)
select '[5] trigger attached' as check, e.tbl||'.'||e.trg as object,
  (tg.tgname is not null) as exists,
  case when tg.tgname is not null then 'PASS' else 'FAIL' end as result
from (values
  ('contests','zz_enforce_account_state'),('contest_options','zz_enforce_account_state'),
  ('contest_predictions','zz_enforce_account_state'),('contest_reports','zz_enforce_account_state'),
  ('contests','trg_contests_guard_update'),
  ('contest_options','trg_contest_options_guard'),
  ('contest_options','trg_contest_options_guard_update'),   -- ← 0152
  ('contest_reports','trg_contest_reports_autovoid'),
  ('contest_predictions','trg_contests_after_prediction')) as e(tbl,trg)
left join pg_trigger tg on tg.tgname=e.trg and tg.tgrelid=('public.'||e.tbl)::regclass and not tg.tgisinternal
order by e.tbl, e.trg;

-- [5b] enforce_account_state_write() が存在するか (= zz_enforce 群の前提 / 0106)
select '[5b] dep function' as check, 'public.enforce_account_state_write()' as object,
  (to_regprocedure('public.enforce_account_state_write()') is not null) as exists,
  case when to_regprocedure('public.enforce_account_state_write()') is not null
       then 'PASS' else 'MISSING (0106 未適用 → zz_enforce トリガは skip されている)' end as result;

-- [6] profiles の contest_* 4 列が存在するか
select '[6] profiles column' as check, e.col as object,
  (col.column_name is not null) as exists, col.data_type as data_type,
  case when col.column_name is not null then 'PASS' else 'FAIL' end as result
from (values ('contest_participation_total'),('contest_streak_weeks'),
             ('contest_titles_count'),('contest_last_participation_week')) as e(col)
left join information_schema.columns col
  on col.table_schema='public' and col.table_name='profiles' and col.column_name=e.col
order by e.col;

-- [7a] pg_cron がインストール済みか
select '[7a] pg_cron installed' as check, 'pg_cron' as object,
  exists (select 1 from pg_extension where extname='pg_cron') as installed,
  case when exists (select 1 from pg_extension where extname='pg_cron') then 'PASS'
       else 'ABSENT (Edge/service_role から process_due_contest_titles() を15分毎に叩く運用にする)' end as result;

-- [7b] cron.job に contest-titles が登録済みか  ※pg_cron 未導入なら [7a] が ABSENT。その場合この [7b] は実行しない
select '[7b] cron job registered' as check, 'contest-titles' as object,
  count(*) > 0 as registered,
  string_agg(schedule||' :: '||command, ' | ') as detail,
  case when count(*) > 0 then 'PASS'
       else 'FAIL (cron.schedule(''contest-titles'',''*/15 * * * *'',''select public.process_due_contest_titles();'') を実行)' end as result
from cron.job where jobname='contest-titles';

-- [8a] ネガティブ: anon は contest_predictions を SELECT できない (匿名票)
select '[8a] neg: anon no SELECT on predictions' as check, 'contest_predictions' as object,
  has_table_privilege('anon','public.contest_predictions','SELECT') as anon_can_select, false as expected,
  case when has_table_privilege('anon','public.contest_predictions','SELECT')=false then 'PASS' else 'FAIL (匿名票漏洩)' end as result;

-- [8b] ネガティブ: contest_answers の唯一の policy は全拒否 (qual='false')
select '[8b] neg: contest_answers all-deny policy' as check, 'contest_answers' as object,
  policyname as policy_name, cmd as applies_to, qual as using_expr, with_check as check_expr,
  case when qual='false' and (with_check='false' or with_check is null) then 'PASS (全拒否)' else 'CHECK' end as result
from pg_policies where schemaname='public' and tablename='contest_answers';

-- [8c] ネガティブ: anon/authenticated は contest_answers に一切の権限なし
select '[8c] neg: no direct grants on contest_answers' as check, r.role as object,
  has_table_privilege(r.role,'public.contest_answers','SELECT') as can_select,
  has_table_privilege(r.role,'public.contest_answers','INSERT') as can_insert,
  case when not has_table_privilege(r.role,'public.contest_answers','SELECT')
        and not has_table_privilege(r.role,'public.contest_answers','INSERT')
        and not has_table_privilege(r.role,'public.contest_answers','UPDATE')
        and not has_table_privilege(r.role,'public.contest_answers','DELETE')
       then 'PASS (全権限なし)' else 'FAIL (直アクセス残存)' end as result
from (values ('anon'),('authenticated')) as r(role);

-- [9] ★0152 ネガティブ: author_id が anon/authenticated に列 SELECT されていない (de-anon backstop)
--     期待: 0 行 (author_id は誰にも列 GRANT していない)
select '[9] neg: author_id not column-granted' as check,
  grantee as role, table_name as object, column_name,
  'FAIL (author_id が読める = de-anon 退行)' as result
from information_schema.role_column_grants
where table_schema='public' and table_name in ('contests','contest_options')
  and column_name='author_id' and privilege_type='SELECT' and grantee in ('anon','authenticated');
-- ↑ 0 行が返れば PASS。1 行でも返れば 0152 §6 が未適用 or 失敗。

-- [9b] 0152 ネガティブの裏: table 全体 SELECT が anon/authenticated から消えているか (期待: 0 行)
select '[9b] neg: no table-wide SELECT on contests/options' as check,
  grantee as role, table_name as object, 'FAIL (table 全体 SELECT 残存 = author_id も読める)' as result
from information_schema.role_table_grants
where table_schema='public' and table_name in ('contests','contest_options')
  and grantee in ('authenticated','anon') and privilege_type='SELECT';
-- ↑ 0 行が返れば PASS。

-- =============================================================================
-- 読み方:
--   [1]-[6] の result が全 PASS かつ [8]-[9b] が空/PASS → 0151+0152 完全適用。
--   [5] の zz_enforce_account_state が FAIL かつ [5b] が MISSING → 先に 0106 を適用。
--   [7a] が ABSENT → pg_cron 無し。[7b] はスキップし称号は Edge/service_role で叩く運用に。
--   [9]/[9b] が行を返す → 0152 §6 が未適用。author_id de-anon が塞がっていない。
-- =============================================================================

-- #############################################################################
-- ★ 0153 (② コンテストコミュニティ) 適用確認 — 0153 を流したら追加で実行
-- #############################################################################
-- [10] communities.entry_contest_id 列
select '[10] communities.entry_contest_id' as check,
  (exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='communities' and column_name='entry_contest_id')) as exists_col,
  case when exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='communities' and column_name='entry_contest_id')
       then 'PASS' else 'FAIL (0153 未適用)' end as result;

-- [11] 0153 関数 + authenticated 実行可
select '[11] 0153 functions' as check, f.sig as object,
  (to_regprocedure(f.sig) is not null) as exists,
  case when to_regprocedure(f.sig) is not null then 'PASS' else 'FAIL' end as result
from (values
  ('public.has_answered_contest(uuid)'),
  ('public.get_contest_join_state(uuid)'),
  ('public.create_contest_community(text,text,text,text,text,text,text,boolean,boolean,timestamptz,timestamptz,timestamptz,text[])')
) as f(sig);

-- [12] ★入会ゲート: community_members_insert_self_open に entry_contest_id 条件が入っているか
select '[12] join gate (RLS) has entry_contest_id' as check, 'community_members_insert_self_open' as object,
  coalesce(with_check ~ 'entry_contest_id', false) as gated,
  case when coalesce(with_check ~ 'entry_contest_id', false) then 'PASS' else 'FAIL (0153 §5 未適用)' end as result
from pg_policies
where schemaname='public' and tablename='community_members' and policyname='community_members_insert_self_open';

-- [13] ★効くゲート: join_community_by_id RPC に contest_gate が入っているか
select '[13] join gate (RPC) has contest_gate' as check, 'join_community_by_id' as object,
  case when to_regprocedure('public.join_community_by_id(uuid)') is null then false
       else pg_get_functiondef('public.join_community_by_id(uuid)'::regprocedure) ~ 'contest_gate' end as gated,
  case when to_regprocedure('public.join_community_by_id(uuid)') is not null
        and pg_get_functiondef('public.join_community_by_id(uuid)'::regprocedure) ~ 'contest_gate'
       then 'PASS' else 'FAIL (0153 §6 未適用 = ゲートが効かない)' end as result;
-- ★ [12] は defense-in-depth、[13] が「実際に効く」ゲート(joinCommunity は join_community_by_id を叩く)。両方 PASS が正。
-- =============================================================================

-- #############################################################################
-- ★ 0154 (選択肢の画像/動画) 適用確認 — 0154 を流したら追加で実行
--    ★重要: client の OPTION_COLS は media_url を読むので、0154 未適用だと
--           contest_options の読み書きが「column does not exist」で壊れる。
-- #############################################################################
-- [14] contest_options.media_url / media_type 列 + その列 SELECT GRANT
select '[14] contest_options media cols' as check, e.col as object,
  (exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='contest_options' and column_name=e.col)) as exists_col,
  (exists (select 1 from information_schema.role_column_grants
           where table_schema='public' and table_name='contest_options' and column_name=e.col
             and privilege_type='SELECT' and grantee='authenticated')) as granted,
  case when (exists (select 1 from information_schema.columns where table_schema='public' and table_name='contest_options' and column_name=e.col))
        and (exists (select 1 from information_schema.role_column_grants where table_schema='public' and table_name='contest_options' and column_name=e.col and privilege_type='SELECT' and grantee='authenticated'))
       then 'PASS' else 'FAIL (0154 未適用 = contest_options 読み書きが壊れる)' end as result
from (values ('media_url'),('media_type')) as e(col);
-- =============================================================================

-- #############################################################################
-- ★ 0155+0156 (期限の任意化 + 砦修正) 適用確認 — 0156 を流したら追加で実行
--    ★0155まで適用で止めると P0(締切なしobjectiveで正解漏れ)が生きる → 0156 必須。
-- #############################################################################
-- [15] lock_at/result_at が NULL 可になっているか (0155)
select '[15] deadlines nullable' as check, c.column_name as object,
  (c.is_nullable = 'YES') as nullable,
  case when c.is_nullable = 'YES' then 'PASS' else 'FAIL (0155 未適用)' end as result
from information_schema.columns c
where c.table_schema='public' and c.table_name='contests' and c.column_name in ('lock_at','result_at');

-- [16] 砦CHECK (0156): objective は lock+result 必須 / objective+submission 禁止 / submission は lock 必須(0155)
select '[16] deadline invariant CHECKs' as check, e.cn as object,
  (exists (select 1 from pg_constraint where conname=e.cn and conrelid='public.contests'::regclass)) as exists,
  case when exists (select 1 from pg_constraint where conname=e.cn and conrelid='public.contests'::regclass)
       then 'PASS' else 'FAIL (0155/0156 未適用)' end as result
from (values ('contests_submission_needs_lock'),('contests_objective_needs_deadlines'),('contests_objective_no_submission')) as e(cn);

-- [17] ★砦: confirm/guard が NULL 安全化されているか (0156 = too_early と guard に lock_at is null 判定)
select '[17] NULL-safe answer gates' as check, e.fn as object,
  (pg_get_functiondef(e.fn::regprocedure) ~ 'lock_at is null') as null_safe,
  case when pg_get_functiondef(e.fn::regprocedure) ~ 'lock_at is null'
       then 'PASS' else 'FAIL (0156 未適用 = 締切なしで正解が漏れる)' end as result
from (values ('public.confirm_contest_result(uuid,uuid)'),('public.contests_guard_update()')) as e(fn);
-- =============================================================================
