-- ============================================================
-- 0146: 新規ユーザーの nickname を匿名ランダムハンドル化 + onboarded を「完了」で統一 (オンボ廃止)
-- ============================================================
-- 背景:
--   オンボーディング簡素化により、ニックネーム設定をマイページに後回しにする
--   (登録は email + パスワードのみ)。従来 handle_new_user (0016) は email の @ より前
--   (例: john@example.com → "john") を nickname に入れていた。
--   この nickname はフィード/コメントでは匿名マスクされ他者に出ないが、
--   「友達一覧」「コミュニティのメンバー/モデレータ一覧」では他者に表示される。
--   後回しにすると、ユーザーが自分で設定するまで「メールの片鱗」がそこに露出する。
--
-- 変更:
--   email を一切使わず、ランダムな "user_xxxxxx" を既定 nickname にする。
--   length(2..20) 制約を満たす (13 文字 = user_ + 8桁hex)。短すぎて寂しい印象を避けるため
--   ランダム部を 8 桁に (衝突空間 16^8≈43億)。nickname に unique 制約は無いため衝突は許容
--   (ランダムなので実質衝突しない)。md5(random()) は拡張不要のコア関数。
--   + handle_new_user の insert に onboarded=true を含め、既存の onboarded=false も一括昇格。
--     オンボ廃止で profiles.onboarded はルーティングのゲートから外れた (client 全廃) が、
--     列は default false なので新規が永続 false で残る data hygiene 問題を解消する
--     (「登録=完了」で統一。列は将来 deprecated 予定)。
--   ※ 既存ユーザーの nickname は変更しない (本人が既に設定済みの可能性があるため触らない)。
--
-- ⚠️ 適用: Netlify は migration を流さない。Supabase SQL エディタで手動適用すること。
--   未適用でも client は壊れない (登録は email+パスワードで動く / 旧トリガが email 先頭を採番するだけ)。
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_nickname text;
begin
  -- 匿名ランダムハンドル: email を使わない (メール片鱗の露出を防ぐ)。
  -- md5(random()||clock_timestamp()) の先頭 8 桁 hex を付与 → 'user_' + 8 = 13 文字
  -- (6 桁だと短く寂しいため 8 桁に。CHECK(length 2..20) 内)。
  v_nickname := 'user_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  -- 既に profile があれば何もしない (二重 insert を防ぐ / 冪等)。
  -- onboarded=true も同時に立てる: オンボ廃止でこのフラグはルーティングのゲートに使われ
  -- なくなったが、default false なので新規が永続 false で残らないよう「登録=完了」で揃える。
  insert into public.profiles(id, nickname, onboarded)
  values (new.id, v_nickname, true)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 関数だけ差し替えれば反映されるが、念のため trigger を再登録
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 既存の未完了ユーザー (onboarded=false) を一括で「完了」に昇格。
-- オンボーディング画面は到達不能になり、彼らも feed に着地している。
-- onboarded はもう client のルーティングのゲートに使われないので、一回限りの無害な data fix。
update public.profiles set onboarded = true where onboarded = false;
