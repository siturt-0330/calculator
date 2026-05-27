-- ============================================================
-- 0060_account_state_notify.sql
-- ============================================================
-- 目的: profiles.account_state が変化した時に、本人へ通知を自動送信する。
--
-- 背景 (Reddit ガイド #11 — 透明性):
--   現状は admin (もしくは refresh_account_state RPC) が account_state を変更しても、
--   ユーザー側には何の通知も透明性もない。「いきなり投稿できなくなった」「警告
--   なしに停止された」と感じさせるのは UX 上致命的で、信頼を失う原因になる。
--
-- 対策:
--   profiles.account_state が distinct な値に UPDATE されたタイミングで
--   public.notifications に 'event' 型の通知を 1 件 insert する。
--   メッセージ本文は state ごとに固定 (i18n 後段で対応予定)。
--   詳細画面 (/settings/account-state) で受けている制限と復帰条件を確認できる。
--
-- 注意:
--   - search_path = public, pg_catalog で hardening (CLAUDE.md § 11)
--   - SECURITY DEFINER で実行 — caller (admin or refresh_account_state) の権限ではなく
--     関数 owner で notifications に書き込む。RLS を bypass するために必要。
--   - 既存 trg_notify_account_state は drop してから再作成 (idempotent)。
--   - notifications.type は 'event' を使う (0037 で許可済)。
-- ============================================================

set local statement_timeout = '5min';

-- ------------------------------------------------------------
-- account_state 変化通知関数
-- ------------------------------------------------------------
create or replace function public.notify_account_state_change()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  msg text;
begin
  -- NULL ↔ value も distinct として扱う (is distinct from)
  if NEW.account_state is distinct from OLD.account_state then
    msg := case NEW.account_state
      when 'caution'    then 'アカウントが警告状態になりました。詳細は設定画面でご確認ください。'
      when 'restricted' then 'アカウントが制限されました。一部の機能が使えなくなります。'
      when 'warned'     then 'アカウント停止予告が発行されました。詳細をご確認ください。'
      when 'suspended'  then 'アカウントが停止されました。'
      when 'healthy'    then 'アカウントが通常状態に復帰しました。'
      else null
    end;
    if msg is not null then
      insert into public.notifications (user_id, type, tag_name, message, read)
      values (NEW.id, 'event', null, msg, false);
    end if;
  end if;
  return NEW;
end;
$$;

-- ------------------------------------------------------------
-- trigger: profiles.account_state UPDATE 時のみ発火
-- ------------------------------------------------------------
drop trigger if exists trg_notify_account_state on public.profiles;
create trigger trg_notify_account_state
  after update of account_state on public.profiles
  for each row execute function public.notify_account_state_change();
