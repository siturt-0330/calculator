-- ============================================================
-- 0148: feature_flags の admin 書き込みポリシー (Admin Console「機能フラグ」画面用)
-- ============================================================
-- 前提: 0147_feature_flags_bootstrap.sql (テーブル作成 + ff_read + realtime publication)。
--   0147 → 0148 の順で適用すること。
--
-- 目的: Admin Console (/admin/flags) からブラウザでフラグを ON/OFF・percentage 変更・
--   新規作成できるようにする。判定は既存の is_admin() (posts_admin_all 等と同じ
--   canonical 述語・本番適用済を確認 2026-06-12)。
--   一般ユーザーは従来どおり select のみ (ff_read)。
--
-- ⚠️ 適用: Supabase SQL エディタで手動適用 (Netlify は migration を流さない)。
-- ============================================================

drop policy if exists "ff_admin_write" on public.feature_flags;
create policy "ff_admin_write" on public.feature_flags
  for all
  using (is_admin())
  with check (is_admin());

-- updated_at を自動更新 (admin UI の「最終更新」表示用)
create or replace function public.touch_feature_flags_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_feature_flags_touch on public.feature_flags;
create trigger trg_feature_flags_touch
  before update on public.feature_flags
  for each row execute procedure public.touch_feature_flags_updated_at();
