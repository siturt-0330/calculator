-- ============================================================
-- 0016: 新規ユーザー signup トリガーの堅牢化
-- ============================================================
-- 問題:
--   0001_schema.sql の handle_new_user() は email の @ より前の部分を
--   そのまま nickname として profile に insert していたが、profiles.nickname
--   には check(length(nickname) between 2 and 20) という制約がある。
--
--   結果として:
--     - "a@example.com" のような 1 文字 prefix のメールでサインアップすると
--       trigger が CHECK 違反を起こし、auth.users insert ごと rollback され、
--       ユーザーが永遠にサインアップできない。
--     - 同様に "very-long-email-address@example.com" のような 20 文字超の
--       prefix も violation で全滅。
--     - 万一 conflict (再実行 / 競合) があると primary key 違反で失敗。
--
-- 修正:
--   - nickname が短い場合は "_user" を付ける
--   - 長い場合は 20 文字に切り詰める
--   - email が null の場合は 'user' フォールバック
--   - 既に profile があれば skip (on conflict do nothing) — 冪等化
--
-- これで初回ユーザーのサインアップが email prefix に関わらず必ず成功する。
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_nickname text;
begin
  -- email がある時は @ より前を取る、無ければ 'user' を使う
  v_nickname := coalesce(split_part(new.email, '@', 1), 'user');

  -- 2 文字未満なら "_u" を付けて満たす
  if length(v_nickname) < 2 then
    v_nickname := v_nickname || '_u';
  end if;

  -- 20 文字を超えたら切り詰める
  if length(v_nickname) > 20 then
    v_nickname := substring(v_nickname from 1 for 20);
  end if;

  -- 既に profile があれば何もしない (二重 insert を防ぐ)
  insert into public.profiles(id, nickname)
  values (new.id, v_nickname)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- トリガー自体は再 create 不要 (関数だけ差し替えれば反映される)
-- ただし念のため drop-create で確実に登録し直す
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
