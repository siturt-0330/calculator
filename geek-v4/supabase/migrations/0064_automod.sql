-- ============================================================
-- 0064_automod.sql
-- ============================================================
-- AutoMod (条件ベース自動モデレーション) — Reddit ガイド #8 / 6.4 章
--
-- 目的: スパム / 荒らし / 個人情報晒し等を「ルールベース GUI」で予防的に
--       捕捉する。YAML で書かせるとミスが多いので、admin 画面で
--       matcher × op × value × action の組合せ表 (UI builder) を
--       構築する。
--
-- 構造:
--   automod_rules — admin が作るルール (conditions JSONB + action)
--     conditions[] : 各要素 { matcher, op, value }
--     複数条件は AND 結合 (将来 OR 分岐は別 jsonb スキーマで)
--   automod_log   — 一致記録 (rule_id, post_id, matched_at)
--
-- 互換性:
--   - public.is_admin() helper は 0027 で導入済
--   - posts.is_hidden は本 migration で初導入 (idempotent add column if not exists)
--
-- 注意:
--   - migration は idempotent
--   - 本 migration では Edge Function は登録しない (deploy は別途)
--   - RLS により admin のみ全権、それ以外は完全に不可視
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) posts.is_hidden カラム (automod の hide action が書き込む)
--    既に存在する環境を想定して idempotent に
-- ============================================================
do $$
begin
  if to_regclass('public.posts') is not null then
    alter table public.posts add column if not exists is_hidden boolean not null default false;
  end if;
end $$;

-- automod は「最近 hidden になった投稿」を index で引きたい可能性があるので
-- partial index を 1 本だけ用意 (true は少数想定)
do $$
begin
  if to_regclass('public.posts') is not null then
    create index if not exists posts_is_hidden_idx
      on public.posts(is_hidden) where is_hidden = true;
  end if;
end $$;

-- ============================================================
-- 2) automod_rules テーブル
-- ============================================================
create table if not exists public.automod_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  description text,
  enabled boolean not null default true,
  -- conditions: jsonb で組み立て型
  -- 例:
  --   [
  --     { "matcher": "author_age_days",   "op": "lt",       "value": 1 },
  --     { "matcher": "post_content",      "op": "contains", "value": "discord.gg" }
  --   ]
  -- 複数条件は AND 結合 (caller 側 evaluator が ALL を判定)
  conditions jsonb not null,
  -- action: 'hide' | 'soft_warn' | 'collapse' | 'notify_admin'
  action text not null check (action in ('hide', 'soft_warn', 'collapse', 'notify_admin')),
  -- action_data: action-specific config
  --   hide          → 不要 ({}) でも {reason: '...'} でも可
  --   soft_warn     → { "message": "..." }
  --   collapse      → { "tag": "auto_collapsed" }
  --   notify_admin  → { "title": "...", "body": "..." }
  action_data jsonb,
  -- 監査
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 統計
  match_count int not null default 0,
  last_matched_at timestamptz
);

create index if not exists automod_rules_enabled_idx
  on public.automod_rules(enabled) where enabled = true;

create index if not exists automod_rules_created_at_idx
  on public.automod_rules(created_at desc);

comment on table public.automod_rules is
  'Reddit ガイド 6.4: GUI で組み立てる自動モデレーションルール。conditions JSONB は { matcher, op, value }[] (AND 結合)。';

-- updated_at を自動更新する trigger
create or replace function public.automod_rules_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_automod_rules_updated_at on public.automod_rules;
create trigger trg_automod_rules_updated_at
  before update on public.automod_rules
  for each row execute function public.automod_rules_set_updated_at();

alter table public.automod_rules enable row level security;

-- admin のみ全権
drop policy if exists "automod_rules_admin_all" on public.automod_rules;
create policy "automod_rules_admin_all" on public.automod_rules
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- ============================================================
-- 3) automod_log テーブル — 何が一致したかの履歴
-- ============================================================
create table if not exists public.automod_log (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automod_rules(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  matched_at timestamptz not null default now()
);

create index if not exists automod_log_rule_idx
  on public.automod_log(rule_id, matched_at desc);

create index if not exists automod_log_matched_at_idx
  on public.automod_log(matched_at desc);

comment on table public.automod_log is
  'AutoMod rule の一致履歴。admin がダッシュボードで 24h 統計を見るために使う。';

alter table public.automod_log enable row level security;

-- admin のみ閲覧可
drop policy if exists "automod_log_admin_read" on public.automod_log;
create policy "automod_log_admin_read" on public.automod_log
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- INSERT は service role (Edge Function) からのみ — 通常クライアントには
-- INSERT policy を付けない (= deny default)。RLS が ON でも service_role は
-- bypass されるので Edge Function はそのまま書ける。

select '0064_automod 完了' as result;
