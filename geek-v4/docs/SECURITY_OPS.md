# SECURITY_OPS — セキュリティ手動適用の手順書 (2026-06 監査対応)

> 対象: 2026-06-11 大規模監査で確定したセキュリティ P1 のうち、**コードでは完結せず
> Supabase ダッシュボード / CLI での手動操作が必要なもの**。上から順に実施する。
> 各ステップに「事前確認 → 適用 → 事後検証」を付けてある。**事後検証まで必ずやる**。

---

## 0. 鉄の禁止事項 (先に読む)

- 🚫 **`complete_schema.sql` を本番 DB で実行しない。** これは新規 DB 一括ブートストラップ用の
  別系統スナップショットで、`profiles_read using(true)`(オープン読み) を再作成し、
  匿名性マスク (0107-0126) と列硬化 (0133/0134/0138) を **一切含まない** =
  流すと de-anon ホールが全面復活する silent-revert 地雷。
- 🚫 migration の既存ファイルを編集しない (revert は新番号ファイルで)。
- 適用はすべて **Supabase ダッシュボード → SQL Editor** で 1 ファイルずつ。
  Netlify は migration を流さない (手動適用が唯一の経路)。

---

## 1. de-anon RPC 適用確認 SQL (S-1・確認のみ / 5分)

主経路 (フィード/コミュ/検索/コメント表示) の author_id マスクは **コード上はクローズ済み**。
残りは「本番 DB に最新 RPC が適用されているか」の確認のみ。SQL Editor で:

```sql
select p.proname,
       (pg_get_functiondef(p.oid) ilike '%is_anonymous%') as has_anon_branch,
       (pg_get_functiondef(p.oid) ilike '%pseudonym_id%')  as has_pseudonym
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_feed_page','get_home_feed','get_community_feed',
                    'get_discovery_payload','get_post_comments');
```

- **5 行とも `has_anon_branch = true` かつ `has_pseudonym = true`** → 主経路クローズ確定。何もしない。
- false の行がある / 行が無い → その RPC の最新 migration (0113 / 0114 / 0115 / 0125 / **0126**) を
  番号順に SQL Editor で適用してから再実行。client は既にマスク前提なので適用は安全側。

---

## 2. migration 0134 — posts 列改竄ホールを塞ぐ (S-3・今すぐ適用可 / 15分)

**何が直るか**: 現状、認証ユーザーは自分の投稿の `likes_count` / `score` / `hot_score` /
`visibility` / `is_public` を REST の直 UPDATE で捏造できる (いいね自演バズ・限定公開の暴露)。
0134 は (1) counter トリガ 3 関数を SECURITY DEFINER 化、(2) posts の table-wide UPDATE を revoke、
(3) 編集してよい 11 列だけ列 GRANT する。

1. **事前確認** — client の UPDATE が whitelist 内であること (済みだが念のため):
   `lib/api/posts.ts` の `updatePost`(11列) と `togglePostQAMode`(qa_mode) のみが
   `.from('posts').update(` を使う。これらは 0134 の GRANT 列に含まれる → client は壊れない。
2. **適用**: `supabase/migrations/0134_post_column_update_hardening.sql` の全文を SQL Editor で実行。
3. **事後検証 (必須・3点)**:
   - **like → counter**: アプリ (本番 web) で任意の投稿にいいね → 数字が増える/減ることを確認。
     ※ DEFINER 化漏れがあると counter トリガが permission denied で死に、いいねが反映されなくなる。
     壊れていたら即 revert ではなく、0134 内の `ALTER FUNCTION ... SECURITY DEFINER` 節を再実行。
   - **改竄が塞がったこと**: SQL Editor で
     ```sql
     -- 自分の post id と自分の JWT で REST から likes_count=999 を試すのが厳密だが、
     -- SQL での近似確認: authenticated ロールの列権限を見る
     select column_name, privilege_type
     from information_schema.column_privileges
     where table_name = 'posts' and grantee = 'authenticated' and privilege_type = 'UPDATE'
     order by column_name;
     ```
     → `likes_count` / `score` / `hot_score` / `visibility` / `is_public` / `author_id` が**出ない**こと
     (出るのは content 等の編集可 11 列のみ)。
   - **投稿編集が生きていること**: アプリで自分の投稿を編集して保存できる。

---

## 3. migration 0138 — author_id の REST 直読みを塞ぐ (S-2・★まだ適用しない)

**何が直るか**: `posts_read = using(true)` + 既定 GRANT のせいで、任意の認証ユーザーが
`.select('author_id')` で匿名投稿の作者 ID を直読みできる (RPC のマスクを素通り)。
0138 は table-wide SELECT を revoke し、author_id **以外**を列 GRANT する backstop。

**🔴 ブロッカー (先にコード修正が必要 — 未完了)**:
- `lib/api/account.ts` の `exportUserData` が `.select('*').eq('author_id', ...)` で
  posts/comments を直読みしている。0138 を先に適用すると 400 → catch → 空配列となり
  **GDPR エクスポートから自分の投稿/コメントが黙って欠落**する。
- 対応方針 (次バッチ): author_id を除く全列を返す**エクスポート専用 SECURITY DEFINER RPC** を
  新 migration で追加 → `account.ts` をそれに移行 → web 反映 (+ native は OTA) →
  行き渡ってから 0138 適用。
  (既存 `get_my_posts`/`get_my_comments` は curated 列のみで GDPR 網羅性が痩せるため不採用)

**適用手順 (ブロッカー解消後)**:
1. `supabase/migrations/0138_author_id_revoke_effective.sql` を SQL Editor で実行。
2. 検証: SQL Editor で
   ```sql
   set local role authenticated;
   select author_id from posts limit 1;  -- → permission denied (42501) になること
   reset role;
   ```
3. アプリ実機: フィード表示 / 自分の投稿一覧 / データエクスポート がすべて動くこと。

---

## 4. Edge Functions 再 deploy (S-4/S-5/S-6 + P0-16 / 10分)

コード修正は本リポジトリで済んでいる (og-fetch redirect手動化+各ホップ再検証 /
og-fetch・og-image の hex IPv6 マップ遮断 / `_shared/cors.ts` に本番ドメイン追加 /
og-image の CORS methods)。**`_shared` が変わったため全関数の再 deploy が必要**:

```bash
cd geek-v4
# Supabase CLI ログイン済み・project link 済み前提 (supabase link --project-ref <ref>)
supabase functions deploy check-content
supabase functions deploy og-fetch
supabase functions deploy og-image
supabase functions deploy automod-eval
supabase functions deploy calculate-trust-score
supabase functions deploy quality-scorer
supabase functions deploy rank-blender
supabase functions deploy search-explainer
supabase functions deploy send-push
supabase functions deploy suggest-caption
```

**事後検証**:
- **CORS (S-6 が直ったこと)**: 本番 web (geekboard.netlify.app) で投稿作成 → モデレーション
  (check-content) がブロックされず動くこと。DevTools Network で check-content のレスポンスに
  `Access-Control-Allow-Origin: https://geekboard.netlify.app` が付くこと。
- **SSRF (S-4/S-5)**: og-fetch に内部 IP リダイレクトを食わせて null になること (任意):
  ```bash
  curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/og-fetch" \
    -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" \
    -d '{"url":"http://[::ffff:7f00:1]/"}'   # → プレビュー null 系の応答であること
  ```

---

## 5. Supabase Auth 設定 (P1-M の仕上げ / 2分)

パスワードリセットの redirect を実稼働ドメインに統一した (コード済)。ダッシュボードで:
- **Authentication → URL Configuration → Redirect URLs** に以下を追加:
  - `https://geekboard.netlify.app/reset-password`
  - (残す) `http://localhost:8081/reset-password` (開発用)
- 旧 `https://geek.app/reset-password` は配信開始まで残しても害なし。

---

## 進行チェックリスト

- [ ] §1 de-anon RPC 確認 SQL → 5行 true/true
- [ ] §2 migration 0134 適用 + like→counter 実機確認 + 列権限確認
- [ ] §4 Edge 全関数 deploy + 本番 CORS 確認
- [ ] §5 Redirect URLs 追加
- [ ] (次バッチ後) §3 export RPC 移行 → 0138 適用 → 42501 確認
