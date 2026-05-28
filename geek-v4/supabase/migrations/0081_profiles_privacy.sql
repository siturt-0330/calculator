-- ============================================================
-- 0081: profiles_read RLS を 自分の行 + admin のみに絞り、
--       他人の機密カラム (phone / bio / account_state /
--       concern_received_count / trust_score / plan / is_admin) を露出させない
-- ============================================================
-- Audit H#1 対応:
--   既存 0001 の `profiles_read using (true)` が
--   ログイン済みの誰でも全ユーザーの全カラムを SELECT できる状態だった。
--   この状態は profiles の以下のカラムを全公開してしまう:
--     - phone               (個人情報。SMS/2FA 用)
--     - bio                 (本人が公開意図しないケースあり)
--     - account_state       (制裁状況。他人に見せない)
--     - concern_received_count (通報数。他人に見せない)
--     - trust_score         (信用度。他人に見せない方針)
--     - plan                (free/pro。他人に見せない方針)
--     - is_admin            (運営の特定に繋がる)
--     - shadowbanned        (シャドウバン状態)
--
-- ⚠️⚠️⚠️ BREAKING CHANGE ⚠️⚠️⚠️
--   このマイグレーション適用後、
--   `supabase.from('profiles').select(...).eq('id', <他人>)` は
--   **空行** を返すようになる (RLS フィルタで除外)。
--   自分の id を指定したクエリ、もしくは admin 権限ありの場合のみ取得可。
--
--   公開しても OK なカラム (id, nickname, avatar_url, avatar_emoji,
--   created_at, post_count, comment_count, like_received_count, onboarded)
--   を他人について読みたい場合は、必ず public.profiles_public **view**
--   を経由すること。view は security_invoker = off で RLS を素通りし、
--   機密カラムは case 式で NULL/default に置換済み。
--
--   client コード側で追従が必要なファイル一覧 (本ファイル末尾コメント参照)。
--
-- 冪等性: drop policy if exists + create or replace view で再実行可。
-- ============================================================

-- ============================================================
-- Step 1: 既存の "誰でも全行 SELECT" な広い policy を撤去
-- ============================================================
drop policy if exists profiles_read on public.profiles;
drop policy if exists "profiles_read" on public.profiles;

-- 念のため: 過去マイグレーションで暫定的に作っていた変種 policy も掃除
drop policy if exists profiles_read_self on public.profiles;
drop policy if exists profiles_read_admin on public.profiles;

-- ============================================================
-- Step 2: 自分の行は full access、admin は全行 full access
--   - 普通のユーザーは「自分の row」を直接 SELECT できる
--     -> phone / bio / account_state など機密カラムを自分について読める
--   - admin は他人の row も SELECT 可
--     -> モデレーション / 監査用に必要
--   - それ以外 (他人の row を SELECT) は 0 件返却
-- ============================================================
create policy profiles_read_self on public.profiles
  for select
  using (
    auth.uid() = id
    or public.current_user_is_admin()
  );

-- ============================================================
-- Step 3: 公開 view を 0020 の security_invoker=on から OFF に切替え
--   security_invoker=on のままだと、上記 Step 2 で他人の行が
--   RLS で弾かれるため view 経由でも他人の (公開してよい) 情報が
--   取れなくなる (= サービスが壊れる)。
--
--   security_invoker=off (= security definer view) にすることで、
--   view は profiles の RLS をバイパスし、
--   view 内の case 式で機密カラムを NULL/default に置換した行を返す。
--   公開してよい column (id / nickname / avatar / count 系) は素通し。
--
--   なお postgres 14 以降の default は security_invoker=off だが、
--   明示する。
-- ============================================================
create or replace view public.profiles_public
with (security_invoker = off) as
select
  id,
  nickname,
  -- 公開してよい cosmetic 情報
  avatar_emoji,
  avatar_url,
  created_at,
  -- 公開してよい集計値 (他人にも表示する UI で使用)
  post_count,
  comment_count,
  like_received_count,
  onboarded,
  -- 機密: 自分にだけ実値、他人には NULL / default
  case when id = auth.uid() then phone                    else null      end as phone,
  case when id = auth.uid() then bio                      else null      end as bio,
  case when id = auth.uid() then account_state            else 'healthy' end as account_state,
  case when id = auth.uid() then concern_received_count   else 0         end as concern_received_count,
  case when id = auth.uid() then trust_score              else null      end as trust_score,
  case when id = auth.uid() then plan                     else null      end as plan,
  case when id = auth.uid() then is_admin                 else false     end as is_admin
from public.profiles;

-- view を直接 SELECT できるよう grant
grant select on public.profiles_public to anon, authenticated;

-- ============================================================
-- Step 4: ⚠️ 必須フォローアップ — client コード側で profiles を
--   直接 SELECT しているファイルの一部は、適用後に「他人の情報が
--   取れない」状態になる。以下のファイルを順に profiles_public 経由
--   へ移行する必要がある (別 PR で対応):
--
--   ✅ 自分の row だけ読むので影響なし:
--     - app/(tabs)/mypage.tsx                 (.eq('id', user.id))
--     - app/(tabs)/feed.tsx                   (.eq('id', userId) ※userId = useAuthStore(s.user?.id))
--     - app/settings/trust-score.tsx          (.eq('id', user.id))
--     - app/settings/profile-edit.tsx         (.eq('id', user.id))
--     - app/settings/plan.tsx                 (.eq('id', user.id))
--     - app/onboarding/nickname.tsx           (upsert id=user.id)
--     - app/onboarding/notifications.tsx      (upsert id=user.id)
--     - components/settings/UserIdentityCard.tsx (.eq('id', user.id))
--     - stores/authStore.ts                   (.eq('id', userId)) ※自分のセッション
--     - lib/api/account.ts                    (.eq('id', uid)) ※自分のアカウント
--     - lib/api/accountState.ts               (.eq('id', user.id))
--     - lib/api/feedback.ts                   (.eq('id', user.id) で is_admin チェック)
--
--   ⚠️ 他人の row を読む — profiles_public への移行が必要:
--     - app/mypage/photo/[id].tsx             (.eq('id', userId) で投稿者プロフィール)
--         → select は id, nickname, avatar_url, avatar_emoji — public columns のみなので view で OK
--     - lib/api/friends.ts                    (.in('id', unique) で複数ユーザー)
--         → select に bio あり。他人の bio は view 経由で null になる (= 仕様としてもそうあるべき)
--     - lib/api/communities.ts                (.in('id', authorIds))
--         → select は id, nickname のみ。view 経由で問題なし
--     - lib/api/communityMods.ts              (.in('id', unique))
--         → select は id, nickname, avatar_url, avatar_emoji。view 経由で問題なし
--
--   ⚠️ admin 経路 — admin policy で読めるので原則影響なし (current_user_is_admin() true の時のみ):
--     - lib/api/admin.ts (多数の query)
--     - lib/api/adminExt.ts
--     - supabase/functions/automod-eval/index.ts  (service_role なので元々 RLS バイパス)
--     - supabase/functions/calculate-trust-score/index.ts (service_role なので RLS バイパス)
--
--   ⚠️ Edge Function (service_role) は RLS 適用外なので影響ゼロ。
-- ============================================================

-- ============================================================
-- Step 5: ロールバック (緊急時) は以下を別マイグレーションで実行:
--   drop policy if exists profiles_read_self on public.profiles;
--   create policy profiles_read on public.profiles for select using (true);
-- ============================================================
