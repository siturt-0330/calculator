-- ============================================================
-- 0147: feature_flags テーブルの本番ブートストラップ + discovery_show_text_posts
-- ============================================================
-- 背景:
--   本番 DB は complete_schema.sql 系のブートストラップで構築されており、
--   0010 の feature_flags テーブルが存在しない (to_regclass で確認済 2026-06-12)。
--   その結果:
--     (1) useFeatureFlag は常に false (fetchFeatureFlags が error→[] で silent degrade)
--     (2) hooks/useUserChannel.ts が feature_flags を .on() で bind しているため、
--         存在しない table の binding が user channel (通知 realtime 等) を
--         CHANNEL_ERROR で殺し得る (CLAUDE.md §5.3 の「1 binding 死で channel 全死」)
--   このファイルは 0010 の feature_flags 節の再掲 (idempotent) + realtime publication
--   登録 + 検索タブ用の新フラグを追加する。
--
-- 新フラグ:
--   discovery_show_text_posts — 検索タブ (Discovery) の投稿カードに「文字だけの投稿」
--   も表示するか。既定 OFF = 画像/動画付きの投稿のみ表示 (2026-06-12 ユーザー要望)。
--   将来のコンテスト機能などで文字投稿も出したくなったら、この行を enabled=true に
--   UPDATE するだけで全クライアントに即時反映される (realtime invalidate 済・再デプロイ不要):
--     update public.feature_flags set enabled = true, updated_at = now()
--      where name = 'discovery_show_text_posts';
--
-- ⚠️ 適用: Supabase SQL エディタで手動適用 (Netlify は migration を流さない)。
--   未適用でも client は壊れない (フラグ不在 = false = 画像/動画のみ表示で要望どおり動く)。
--   適用すると (a) 管理側からの ON/OFF が可能になり、(b) user channel の
--   feature_flags binding が正常化する。
-- ============================================================

create table if not exists public.feature_flags (
  name text primary key,
  description text,
  enabled boolean not null default false,
  percentage integer not null default 100 check (percentage between 0 and 100),
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
drop policy if exists "ff_read" on public.feature_flags;
create policy "ff_read" on public.feature_flags for select using (true);
-- 書き込みポリシーは意図的に作らない (変更は service_role / SQL エディタ経由のみ)

-- 0010 の初期フラグ (既に行があれば触らない) + 新フラグ
insert into public.feature_flags (name, description, enabled, percentage) values
  ('og_preview',         '投稿の出典URLをカード化する',         true,  100),
  ('markdown_render',    '投稿本文の軽量Markdownレンダリング',  true,  100),
  ('quick_reaction',     '投稿カード長押しで素早くリアクション', true,  100),
  ('concerns_privacy',   '気になるをこっそり付けるモード',      true,  100),
  ('profile_summary',    'マイページの自分の活動サマリー',      true,  100),
  ('discovery_show_text_posts', '検索タブの投稿カードに文字だけの投稿も表示 (コンテスト機能用・既定OFF=画像/動画付きのみ)', false, 100)
on conflict (name) do nothing;

-- realtime publication 登録 (useUserChannel の .on(feature_flags) を正常化)
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feature_flags'
  ) then
    alter publication supabase_realtime add table public.feature_flags;
  end if;
end $$;

select 'feature_flags rows: ' || count(*)::text as note from public.feature_flags;
