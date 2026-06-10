---
tags: [geek, security, anonymity, de-anon, supabase, rls, privacy, architecture]
---

# 匿名性設計と de-anon ホール

GEEK のコアバリュー第1は「**完全匿名性** — 投稿者名は絶対表示しない」。`is_anonymous=true` の投稿は、本人以外には誰が書いたか構造的に分からないことが製品の約束。このノートは、その約束を**裏切る既存の de-anon(脱匿名)ホール**と、それを段階的に封じ込めるための実装(マスク / REVOKE / 擬似名トークン)、そして**まだ閉じていない穴(★)**を、実コードに基づいて記録する。

> 一言で: 「**RLS は行を守れても列を守れない**」。匿名性の核 `author_id` は、行レベル RLS (`for select using(true)`) では隠せず、**列権限 + RPC マスク**の二段でしか守れない。ここを取り違えると「緑ビルドなのに匿名性が漏れている」状態になる。

関連: [[アーキテクチャ概要]] / [[データ層・Supabase・RLS・マイグレーション運用]] / [[認証・セッション]] / [[フィード・ランキング・レコメンド]] / [[地雷・落とし穴 総覧]]

---

## 概要 — 何が「匿名を破る」のか

匿名投稿の de-anon は、次の **2 つの部品が揃うと成立**する:

1. **identity 列の漏洩**: 投稿/コメントの実 `author_id` (= `auth.users` の UUID) が client に届く。これは feed RPC・直 REST SELECT・realtime payload・検索用ビューなど**複数経路**から漏れうる。
2. **id→実名の解決オラクル**: `profiles_public` ビュー (`migrations/0081`) が `id / nickname / avatar_url / avatar_emoji` を **anon/authenticated に grant** で素通し公開していた。`select nickname from profiles_public where id in (...)` するだけで「匿名で書いた人」を一斉に実名特定できた。

この2つが揃うと、攻撃者は feed の `author_id` を集める → `profiles_public` で nickname に変換、で**匿名投稿を一括 de-anon**できた。さらに同一 `author_id` 相関で**別々の匿名投稿の名寄せ**(同じ人が書いた、の特定)も可能だった。`avatar_url` 経由の逆引き(投稿の avatar → `profiles_public` で照合 → nickname)も同じオラクルの別ルート。

### 段階的封じ込めの全体像

| 段階 | 何をするか | 状態 |
|---|---|---|
| **RPC マスク** | feed/検索 RPC の出力で匿名 `author_id` を `NULL` に。`is_own` を server 供給 | ✅ migration 実装済 (0113/0114/0115) |
| **avatar オラクル遮断** | `profiles_public` の SELECT を anon/authenticated から REVOKE | ✅ 実装済 (0127)。client 未使用なので無破壊 |
| **擬似名トークン土台** | `profiles.pseudonym_id` (per-user 安定 random UUID) を追加。author_id の代替 | ✅ 実装済 (0116) |
| **author_id 列 REVOKE (backstop)** | 直 REST `.select('author_id')` を DB 層で恒久遮断 | ★ **0129 は no-op / 0138 が是正版・未適用** |
| **realtime allowlist** | posts UPDATE の payload から author_id を pick で除外 | ★ **未実装**(`useFeed.ts` が丸ごと spread) |
| **GDPR export RPC 化** | exportUserData の author_id 直読みを RPC へ | ★ **未対応ブロッカー** |

> ⚠️ **REVOKE は適用順が命**。client が author_id を select しなくなる前に列 REVOKE を打つと、直 REST が PostgREST 400 (`permission denied for column author_id`) で**フィード/コメント/admin が全死**する。「author_id-free client を先に deploy → 後で REVOKE」の順を厳守。

---

## 仕組み・設計(具体ファイルパス付き)

### 1. de-anon の漏洩経路(2026-06-04 完全監査で確定した 7 経路)

`get_home_feed` セキュリティレビュー(4並列敵対監査)+ 完全監査で確定した、author_id が client に届く全経路:

1. **`get_feed_page`** (`migrations/0107`) — フィード周辺データ RPC。元々 `author_id` 非マスク(本番稼働中だった)
2. **`get_home_feed`** (`migrations/0114`) — home feed 1ページ目集約 RPC
3. **`get_community_feed`** (`migrations/0112`) — コミュニティタブ RPC
4. **本丸 = `lib/api/posts.ts` の `POSTS_SELECT_COLS`** — `fetchPosts`/`fetchCommunityPosts`/`fetchPostById` が `author_id` を**直 SELECT**(RPC マスクを完全 bypass)
5. **`lib/api/comments.ts` / `lib/api/bbs.ts`** — 同様に直 select
6. **realtime**: `hooks/useFeed.ts` が posts UPDATE の `payload.new`(WAL の**全列** = author_id 含む)を spread。posts は full-row publication (`migrations/0008`)
7. **`posts.author_id` に列 revoke 無し** + **第2オラクル** `v_search_signals` (`migrations/0087`) が全 post の author_id を anon/authenticated grant。`profiles_public` (`0081`) が id→nickname 解決器

経緯メモ: feed RPC のマスクは **0076 で一度導入されたが、0078(get_feed_page)/0079(get_community_feed) の IDOR gate 追加時に 0075 body ベースで書き直したためマスクが落ち、carry-forward された回帰**。検索タブの 0113 だけが正しくマスクを保っていた(リファレンス実装)。

### 2. RPC マスク — `author_id` を出力で NULL に統一(0113 / 0114 / 0115)

全 feed/検索 RPC は、出力 JSON で匿名投稿の `author_id` を **viewer 本人以外には NULL** にする CASE で統一されている。逐語一致の式:

```sql
-- 0115 get_feed_page (286-293行), get_community_feed (441-448行),
-- 0113 get_discovery_payload (138-145行), 0114 get_home_feed すべて同形
'author_id',
  case
    when pr.is_anonymous
     and (v_viewer is null or v_viewer is distinct from pr.author_id)
    then null
    else pr.author_id
  end,
```

設計上の要点(`migrations/0115` ヘッダより):

- **`v_viewer := auth.uid()`** が authoritative source。`p_user_id` 引数は IDOR gate(`p_user_id <> auth.uid()` なら `42501`)で本人確認に使うだけ。
- **`official_author` は「マスク前の実 author_id」で先に解決**してから author_id を NULL にする。公式コミュ管理者が名前付き返信した投稿(`official_author`)は、マスクしても表示が壊れない(検証済)。CTE `official_lookup` / `hot_official` が `c.official_admin_user_id = p.author_id` を join。
- **可視性述語は維持**: SECURITY DEFINER は RLS(`migrations/0061` `posts_select_visibility`)を bypass するため、関数内で `(public.can_view_post(p.id) or p.author_id = auth.uid()) and public.author_visible(p.author_id)` を再適用。これを欠くと private/community_only/shadowbanned 投稿が漏れる。
- **non-anon の nickname は別**: `get_community_feed` は `author_nickname` を `case when pr.is_anonymous then null else prof.nickname end` で返す(非匿名投稿のみ実名表示、匿名は NULL)。

### 3. `is_own` の server 供給 — author_id 消費を置換する鍵

client は従来 `post.author_id === me` で「自分の投稿か」を判定していた。author_id を列 REVOKE すると client は author_id を取得できなくなるため、**判定そのものを server に移譲**する。全 feed RPC が `is_own` boolean を返す:

```sql
-- 0115 get_feed_page:295行 / get_community_feed:450行
'is_own', (v_viewer is not null and pr.author_id = v_viewer),
```

これにより client は「他人の author_id を一切持たずに」自分の投稿だけ編集/削除 UI を出せる。`lib/api/posts.ts` 側の対応(コメント 950-954行)では、削除は **RLS (`posts_update = auth.uid()=author_id`) が本人以外を弾く**ことに依拠し、client は author_id を送らず・突合せず、0件更新なら error を出す(silent success 回避)。

### 4. avatar→nickname オラクルの遮断(0127)

`migrations/0127_revoke_profiles_public.sql`:

```sql
revoke select on public.profiles_public from anon;
revoke select on public.profiles_public from authenticated;
```

- **client は `profiles_public` を一切読んでいない**(調査で 0 箇所確認。直 base table / マスク RPC 経由のみ)。よって REVOKE しても旧バイナリ含め client は壊れない → native OTA を待たず単独適用可。
- view 本体は **DROP せず残す**(将来 admin/server 用途で narrow に grant し直せるように)。
- ★ **不変条件**: `profiles_public` に `pseudonym_id` を**絶対に追加しない**。足すと token→nickname の逆引きが復活する(後述)。

### 5. 擬似名トークン `pseudonym_id`(0116)

author_id を client から完全に消すと、匿名擬似名(handle/色)の生成入力が無くなる。代替が `profiles.pseudonym_id`:

```sql
-- 0116_add_pseudonym_id.sql
alter table public.profiles
  add column if not exists pseudonym_id uuid not null default gen_random_uuid();
create unique index if not exists profiles_pseudonym_id_key
  on public.profiles (pseudonym_id);
```

- **per-user 安定・auth user_id とは無相関**の random UUID。`pseudonymFor()`(`lib/` の擬似名生成、FNV ハッシュ)の入力を `author_id` → `author_token`(= pseudonym_id)に差し替える。ハッシュロジックは不変。
- 後続 RPC(`migrations/0125 deanon_rpcs` / `0126 feed_rpc_avatar` / `0143`)が匿名 author の `author_token = pseudonym_id` を返す。非匿名は NULL。
- `/user` 擬似プロフィールは `get_pseudo_profile_posts(pseudonym_id)` 系 RPC で author_id 非露出のまま解決。
- ★ **de-anon 防止の構造的保証**: token が join 鍵(`profiles.id`)に現れないため、**token→nickname の解決路が存在しない**(構造的に de-anon 不能)。だから `profiles_public` に絶対 pseudonym_id を足さない。
- 注意: 切り替えで**全ユーザーの匿名 handle/色が一度だけ変わる**(識別子が author_id→pseudonym_id に変わるため)。実害は小(どちらも安定識別子)。

### 6. author_id 列 REVOKE backstop — 0129 の罠と 0138 の是正

直 REST(経路④⑤)を DB 層で恒久遮断する最後の砦。**ここに PostgreSQL 仕様の罠**がある。

**0129 は no-op だった**(`migrations/0129_revoke_author_id.sql`)。`revoke select (author_id) on posts/comments from anon, authenticated` を撃ったが効かない。理由(`migrations/0138` ヘッダの解説):

> ある列の実効 SELECT 権限 = **(table 全体 SELECT) OR (列単位 SELECT)**。Supabase は project 既定で `grant all on all tables in schema public to anon, authenticated`(= table 全体 SELECT)を撒く。この既定 grant を取り消す migration は存在しない(grep 済)。よって列単位 REVOKE は table 権限側に覆われ、**author_id は読めたまま**。

正しい形 = **0134 の SELECT 版**(`migrations/0138_author_id_revoke_effective.sql`、★未適用):「table 全体 SELECT を先に REVOKE → author_id を除く全列を列 GRANT」。

```sql
-- 0138 posts (comments も同形)。列リストは information_schema から動的取得
revoke select on public.posts from authenticated, anon;
execute format('grant select (%s) on public.posts to authenticated, anon', cols);
-- cols = author_id 以外の現存全列 (ordinal_position 順)
```

- **列リストを動的取得する理由**: posts は 0001〜多数の migration で列が増えており、手で列挙すると 1 つの取りこぼしでその列が permission denied になり**全 post 取得が壊れる**。スキーマ drift にも追従。
- **フェイルセーフ DO ブロック**: (A) author_id が anon/authenticated に SELECT 可能なまま残っていないか(security assert)、(B) author_id 以外の全列が GRANT 済か(availability assert)を実行時に検証。assert 破れで do ブロックごと rollback(中途半端な「revoke だけ通って grant 前に中断 → フィード全死」を防ぐ)。
- type-check + test631 緑(2026-06-09 時点)。

> 同型の UPDATE 版が `migrations/0134_post_column_update_hardening.sql`(★未適用)。RLS `posts_update` が**行しか制限せず列を制限しない**ため、認証ユーザが自分の投稿に `update posts set likes_count=99999, visibility='public' ...` を直 REST で撃てた(いいね数/ランキング/公開範囲の捏造)。「table revoke → 11列のみ列 GRANT(updatePost/togglePostQAMode が触る列)」+ counter トリガを `ALTER FUNCTION ... SECURITY DEFINER` 化(DEFINER でないと列 revoke 後に like 押下で 42501)。詳細は [[データ層・Supabase・RLS・マイグレーション運用]]。

### 7. client 側の現状(2026-06-10 コード確認)

de-anon Phase2 の client 改修は**大半が反映済み**:

- `lib/api/posts.ts:108-109` の **`POSTS_SELECT_COLS` から `author_id` は除去済み**(本文/media/counters のみ)。`POSTS_SELECT_COLS_WITH_COMM` も embed 廃止で base と同一(120-121行)。official_author は RPC 供給に移管(115-119行)。
- feed / post 詳細 / my-posts は author_id 非取得で REVOKE 安全。

---

## 注意点・地雷

### ★ 未解決ブロッカー(0138 を適用すると壊れる箇所)

1. **🔴 `lib/api/account.ts` の `exportUserData`(GDPR エクスポート)が author_id を直読みしている — 2026-06-10 確認で現存**。
   - `account.ts:97-100`: `fetchUserTable('posts', 'author_id', uid, ...)` / `'comments'` / `'bbs_threads'` / `'bbs_replies'` を `.eq('author_id', uid)` で引く。
   - `account.ts:211-214`: 退会 delete も `{ table: 'posts', col: 'author_id' }` 等で同型。
   - これは**常時・認証経路・RPC primary 無し**。0138 適用後は permission denied で catch され、「自分の posts/comments がエクスポートから黙って欠落」(クラッシュではない silent degrade = GDPR 開示の欠落退行)。
   - 対策: `auth.uid()` ベースの SECURITY DEFINER RPC 化(`get_my_posts`/`get_my_comments` 流用可)。**これが 0138 適用の最大ブロッカー**。
   - 退会の REST フォールバックも同型だが `delete_account` RPC(`migrations/0077`)が primary なら通常到達しない。

2. **★ realtime allowlist が未実装 — 2026-06-10 確認で現存**。`hooks/useFeed.ts:443,449` が posts UPDATE の payload を丸ごと spread:
   ```ts
   const updated = payload.new as Partial<Post> & { id: string };
   updateBuffer.current.set(updated.id, { ...(existing ?? {}), ...updated });
   ```
   **Realtime は列 SELECT 権限を尊重しない**(WAL の全列を配信)。posts は full-row publication なので、`payload.new` には `author_id` が含まれ、それが client cache の Post に merge される = **0138/0129 の REVOKE では塞がらない de-anon 残穴**。逆に言えば REVOKE で realtime が壊れることも無い。
   - 対策: payload から必要列だけ pick する allowlist 化(`useFeed.ts` の UPDATE ハンドラ + `useUserChannel.ts` の通知 INSERT も同様)。

3. **第2/第3オラクル(REVOKE では閉じない)**: `v_search_signals`(`0087:236,246`)/ `trending_in_window`(`0087:191,223`)/ `signal_sparsification_stats`(`0093`)が author_id を grant。**admin views** `admin_reported_posts_v`(`0031:111`)/ `admin_problem_users_v`(`0031:133`)が**全 authenticated に grant** = 今すぐ悪用可能な「通報/問題ユーザの匿名著者を一般ユーザが特定できる権限昇格オラクル」。→ revoke from authenticated + is_admin gated RPC 化が必要。

4. **admin は `authenticated` ロール**。REVOKE すると admin の直 select(`admin.ts`/`adminExt.ts` 多数)も全壊する。**admin 全面 is_admin RPC 化(`migrations/0128`)が REVOKE の前提条件**。

### 適用順の鉄則(再掲・最重要)

`migrations/0129/0138` ヘッダの ★★★ 警告:

1. client 改修(author_id を select/eq しない)が **web + native(OTA)に行き渡る**まで REVOKE を打たない。
2. author_id を読む全経路が **SECURITY DEFINER RPC primary** になり、その RPC が **prod 適用済み**であること(`get_post_comments` 0125 / `get_my_comments` 0130 / `get_my_posts` 0117,0131 / `get_community_feed` 0042,0112 / admin_* 0128 / `delete_account` 0077)。
3. **deploy 順**: author_id-free client を先に deploy → **後で** REVOKE 適用。逆だと旧 client の直 select が PostgREST 400。

### 緑ビルド ≠ 匿名性が守られている

- 0129 が「migration として通って緑」なのに**実効ゼロ**だった(列 REVOKE が table 権限に覆われる)のは典型例。**type-check/lint/test が通っても de-anon は閉じていない**ことがある。F(REVOKE)適用前には敵対的 de-anon 監査 workflow を回す方針。詳細は [[地雷・落とし穴 総覧]] / [[運用 — デプロイ・プレビュー・本番反映確認]]。
- マイグレーションは **Supabase SQL エディタで手動適用**する運用。SECURITY DEFINER 関数を含む migration は **nested dollar-quote ($$ と $fn$)** を editor の statement splitter が誤分割し `ERROR 42601 syntax error at uuid` になる → **top-level の `create or replace function` で書く**(0113/0114/0115 は top-level 化済)。詳細は [[データ層・Supabase・RLS・マイグレーション運用]]。

### 設計判断のサマリ(なぜこの形か)

- **mod の kick/ban は「削除のみ」に縮小**: author_id を NULL マスクすると author_id 依存の kick/ban が壊れる。さらに「匿名投稿の author を ban = de-anon」になる。当初の `mod_*_by_content` RPC(0116案)は「解決 author を log に記録 → mod が読み戻して de-anon」する**mod 専用オラクル**と判明し廃止。削除は id ベース(author 不要)なので維持。メンバー kick/ban は既知 member 一覧経由のみ。
- **BBS は dead code として除外**(`fetchReplies`/`getThreadUserId` 呼出 0)。将来再配線時は RPC+token 必須。
- **mod_action_logs.target_user_id は実 author を残す**(mod のみ閲覧・運用上必要)。

---

## 関連

- [[アーキテクチャ概要]] — システム全体の中での匿名性レイヤの位置
- [[データ層・Supabase・RLS・マイグレーション運用]] — RLS/列権限/マイグレーション手動適用・nested dollar-quote 罠・0134 列 UPDATE hardening
- [[認証・セッション]] — `auth.uid()` を authoritative source とする IDOR gate / guard_profile_update
- [[フィード・ランキング・レコメンド]] — feed RPC(get_home_feed/get_feed_page/get_discovery_payload)本体・official_author
- [[State管理 (Zustand・React Query)]] — `['feed-page']` cache の共有 seed と author_id 整合
- [[Realtime]] — full-row publication と payload allowlist pick の必要性(de-anon 残穴)
- [[画像・メディアパイプライン]] — avatar_url 経由の逆引きオラクル(0127 で遮断)
- [[Admin Console (運営管理)]] — admin views の権限昇格オラクル / is_admin gated RPC 化
- [[機能一覧・仕様サマリー]] — 「完全匿名性」コアバリューの製品要件
- [[地雷・落とし穴 総覧]] — 緑ビルド≠安全 / 0129 no-op の教訓
- [[運用 — デプロイ・プレビュー・本番反映確認]] — REVOKE の適用順・敵対監査ゲート
