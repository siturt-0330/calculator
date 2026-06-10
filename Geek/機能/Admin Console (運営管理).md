---
tags: [geek, admin, moderation, rbac, ads, migration, security, supabase]
---

# Admin Console (運営管理)

Geek (geek-v4) の運営管理ダッシュボード。通報トリアージ・段階的措置・ユーザー/投稿管理・流入元別広告配信・監査ログを 1 つの隠し画面群に束ねたもの。**「ゼロから新規構築」ではなく「既に約 6,000 行・10 画面実装済みだったものに、欠けていた中核(リアルタイム通報・ケース集約・RBAC・流入元別広告・監査ログ完全化)を足して完成させた」** のが実態 (`docs/ADMIN_CONSOLE.md` §1.1)。PR #153 で master 反映済み (`cd16b8b`)。

> [!danger] 最重要の罠 — migration 0118-0123 は手動適用必須・未適用でも silent degrade
> 後述の通り、これらの migration を Supabase SQL エディタで番号順に手動適用しないと、**クラッシュせず中途半端に動く**(通報が常に 0 件 / 担当・解決が押せない / 広告が priority 配信されない)。「動いてるけど挙動が変」は真っ先にこれを疑う。詳細は [[#注意点・地雷]]。

関連: [[機能一覧・仕様サマリー]] / [[データ層・Supabase・RLS・マイグレーション運用]] / [[認証・セッション]] / [[匿名性設計と de-anon ホール]] / [[Realtime]] / [[地雷・落とし穴 総覧]] / [[運用 — デプロイ・プレビュー・本番反映確認]]

---

## 概要

### どこからアクセスするか

2 つの入口があり、どちらも `siturt0330@gmail.com` だけが入れる。

| 入口 | 実体 | gate |
|---|---|---|
| 本体アプリの `/admin` URL 直打ち | `geek-v4/app/admin/*`(コードはここに在る) | client: `app/admin/_layout.tsx` で `user.email !== ADMIN_EMAIL` なら `/(tabs)/feed` へ Redirect。server: RLS `is_admin()` |
| 別アプリ `geek-admin/`(独立 Expo Web) | `geek-v4/app/admin/index` を **re-export** するだけ | client: `geek-admin/app/_layout.tsx` の `AdminLogin`。server: 同じ RLS |

- 本体アプリのナビゲーションには `/admin` へのリンクを一切生やしていない (隠し画面)。URL を知らないと辿り着けない。
- **真の防御は client gate ではなく RLS**。email を偽装して URL を直打ちしても、`is_admin()` が false なら全 query が空配列を返すだけ (`app/admin/_layout.tsx` のコメントに「URL 直打ち + email 偽装が出来ても、データは何も取れない」と明記)。
- ⚠️ **別アプリ `geek-admin` は現状ランタイムで動かない**(`geek-admin/README.md`: 「React の useState/useEffect が null — geek-admin と geek-v4 の node_modules に React が二重に存在し Metro が両方バンドルすると Context が壊れる」)。`docs/ADMIN_CONSOLE.md` §2.1 もこれを理由に「本体 `geek-v4/app/admin/` で構築する」と判断。**実運用は本体の `/admin` 経路**。geek-admin は将来の最適化課題として保留 (★未解決)。

### 主要機能 (画面)

`app/admin/` 配下:

| ファイル | 役割 |
|---|---|
| `index.tsx` | ダッシュボード本体。KPI 6 カード + health indicator + 4 タブ(ダッシュボード/通報/ユーザー/投稿) |
| `reports.tsx` | **通報キュー(report_cases ベース)**。優先度順・担当アサイン・解決ワークフロー。0118 の中核 UI |
| `users.tsx` | ユーザー管理(Shadowban 等) |
| `user/[id].tsx` | ユーザー詳細 + 措置 (`EnforcementPanel` を埋め込む) |
| `post/[id].tsx` | 投稿詳細・モデレーション |
| `message/[userId].tsx` | 運営からユーザーへ DM |
| `ads.tsx` | 広告の作成・編集・配信実績 (タグターゲティング + 流入元別) |
| `automod.tsx` | 自動モデレーション ルール (`AutomodRuleCard`/`AutomodRuleEditor`) |
| `support.tsx` | サポート/フィードバック |
| `official-apps.tsx` | 公式コミュニティ申請の承認/却下 |

`components/admin/`: `AdminBlocks.tsx`(Stat/EmptyBlock/ErrorBlock) / `EnforcementPanel.tsx`(段階的措置パネル) / `MiniMetric.tsx` / `AutomodRuleCard.tsx` / `AutomodRuleEditor.tsx`。

### 5 つの中核機能 (0118-0123 で追加した部分)

1. **通報のリアルタイム通知**(指示書 4.4 の「中核」) — 旧来はポーリングのみ → `admin_notifications` を Supabase Realtime で購読し新着で即反映。
2. **通報ワークフロー本格化** — `report_cases` でケース集約(対象単位)・優先度・担当アサイン・status・解決/却下。
3. **段階的措置 + 異議申立** — `enforcement_actions`(警告→機能制限→一時停止→永久BAN)+ `appeals`。
4. **広告の流入元別配信** — `user_acquisition`(流入元)+ `ads` に `source_type`/`priority`/`target_traffic_sources`。
5. **RBAC** — `is_admin` boolean → `admin_role`(none/viewer/moderator/admin)へ後方互換で段階導入。

---

## 仕組み・設計

### マイグレーション 0118-0123 (この機能の心臓部)

すべて `geek-v4/supabase/migrations/` 配下。冪等・top-level 定義(SQL editor の nested do-block 誤分割対策)・**手動適用前提**で書かれている。

| # | ファイル | 内容 |
|---|---|---|
| 0118 | `0118_report_cases.sql` | `report_cases` テーブル + 集約トリガ `bump_report_case` + RPC `get_report_queue`/`assign_report_case`/`resolve_report_case` + `moderation_log` を append-only 化 + 既存 reports を backfill |
| 0119 | `0119_traffic_source_and_ads.sql` | `user_acquisition`(流入元・本人/admin 限定)+ `ads` に `source_type`/`priority`/`target_traffic_sources`/`network_code` 列追加 + GIN/priority index |
| 0120 | `0120_admin_rbac.sql` | `profiles.admin_role` 列 + `is_admin()` を admin_role 基準に**後方互換再定義** + `is_moderator()`/`can_view_admin()` 追加 + `set_admin_role()` RPC + admin_role の直接 UPDATE を revoke |
| 0121 | `0121_admin_notifications.sql` | `admin_notifications` テーブル + 既読 RPC `mark_admin_notification_read` + `report_cases` INSERT トリガで通知投入 + **Realtime publication 登録** |
| 0122 | `0122_enforcement_and_appeals.sql` | `enforcement_actions`(append-only)+ `appeals` + RPC `apply_enforcement`/`active_strike_count`/`review_appeal` |
| 0123 | `0123_open_moderation_to_moderators.sql` | RBAC Phase2: `report_cases` RLS と通報 3 RPC の gate を `is_admin()` → `is_moderator()` に開放(措置/広告/RBAC は admin のまま) |

動作確認シード: `scripts/seed_admin_console.sql`(冪等 DO ブロック、存在確認済み)。

#### 0118 通報ケースの設計ポイント

- **集約**: `reports`(0001)はそのまま温存し、reports INSERT トリガ `bump_report_case` が対象(投稿)単位の `report_cases` を upsert する。未解決(open/triaged/in_review)は 1 対象 1 ケースに束ねる(部分 unique index `report_cases_open_target_uniq`)。resolved/rejected は履歴として複数残る。
- **severity 導出**: `report_reason_severity()` が理由 → critical/high/medium/low に写像(csam/violence=critical, harassment/inappropriate/scam=high, misinfo/spam=medium, それ以外=low)。severity は引き上げのみ(下げない)。
- **優先度スコア** (`get_report_queue` 内):
  ```sql
  prio = report_severity_weight(severity)   -- critical=1000 high=100 medium=10 low=1
       + report_count * 5
       + greatest(0, 100 - (経過時間[h]))::int  -- 直近ほど高い recency bonus
  ```
  critical は weight 1000 で常に最上位(ハードルール相当)。
- **author_id を実値で返す**: `get_report_queue` は `post.author_id` を実値で返す。これは admin/moderator gate 済みだから許される(一般ユーザー向け匿名フィードでは絶対にやらない → [[匿名性設計と de-anon ホール]])。
- **append-only 監査**: `moderation_log` の `for all` policy を select + insert に分離し、**UPDATE/DELETE policy を作らない=全ロールで改ざん不可**。

#### 0120 RBAC の後方互換テクニック

- `admin_role` 列(既定 'none', check で none/viewer/moderator/admin)を追加。
- **再定義前に** `update profiles set admin_role='admin' where is_admin=true` を実行(これを先にやらないと `is_admin()` 再定義の瞬間に既存 admin が権限を失う)。
- `is_admin()` の署名(引数なし)を変えずに body だけ admin_role 基準へ書き換え → これを呼ぶ全 RLS/関数がそのまま動く(既存破壊なし)。
- **admin_role の自己昇格を封じる仕掛け**: `profiles_update` policy は本人 UPDATE を許す & `guard_profile_update`(0105)は新列 admin_role を知らない。そこで `revoke update (admin_role) ... from authenticated/anon` で**列レベルで剥奪**し、変更は SECURITY DEFINER の `set_admin_role()` RPC(owner 権限で revoke を越える)経由のみに限定。

#### 0122 段階的措置 (progressive enforcement)

- level ladder: `0:警告 / 1:機能制限 / 2:一時停止 / 3:永久BAN`。strike(level≤1)は issued+**90 日で失効**(`active_strike_count` は失効していない level≤1 を数える)。重大違反は `p_level=3` を直接渡せば累積を待たず即 BAN(バイパス)。
- `apply_enforcement()` は 1 トランザクションで「`enforcement_actions` へ insert + `profiles.account_state` 同期(3/2→suspended, 1→restricted, 0→caution)+ `moderation_log` へ記録」。
- `enforcement_actions`/`appeals` とも append-only(UPDATE/DELETE policy 無し)。`appeals` は本人が insert、admin が `review_appeal()` で承認/却下。

### 権限マトリクス (RBAC)

0123 適用後の最終形:

| 操作 | viewer | moderator | admin |
|---|:--:|:--:|:--:|
| admin console 閲覧 (`can_view_admin()`) | ✅ | ✅ | ✅ |
| 通報トリアージ(queue 取得/担当/解決) | ✅(0123 で開放) | ✅ | ✅ |
| 段階的措置 `apply_enforcement` | ❌ | ❌ | ✅ |
| 異議審査 `review_appeal` | ❌ | ❌ | ✅ |
| ロール付与 `set_admin_role` | ❌ | ❌ | ✅ |
| 広告 CRUD / shadowban | ❌ | ❌ | ✅ |

`is_moderator()` = `admin_role in ('moderator','admin')` なので admin は moderator の権限も通る。

### クライアント層 (lib/api / hooks)

`docs/ADMIN_CONSOLE.md` のマージ前レビュー指摘で「**全 DB 呼び出しを `withApiTimeout(8s)` で包む / 空 catch は `swallow` に**」が徹底されている([[State管理 (Zustand・React Query)]] の標準パターン)。

| ファイル | 役割 |
|---|---|
| `lib/api/admin.ts` | 基本 CRUD(`fetchAllUsers`/`fetchAllPosts`/`suspendUser`/`deletePost` 等) |
| `lib/api/adminExt.ts` | view/RPC 群(`fetchAdminDashboardStats`/`fetchReportedPosts`/`fetchProblemUsers`/`fetchModerationLog`)。0128 SECURITY DEFINER RPC 経由で author_id を読み、未適用なら `admin_reported_posts_v` 直読に fallback |
| `lib/api/adminReports.ts` | 0118 RPC ラッパ。`fetchReportQueue`/`assignReportCase`/`resolveReportCase`。**0118 未適用なら concern 集計 fallback** |
| `lib/api/enforcement.ts` | 0122 RPC ラッパ。`applyEnforcement`/`fetchEnforcementHistory`/`fetchActiveStrikeCount`/`fetchAppeals`/`reviewAppeal`。`ENFORCEMENT_LABELS` 定数あり |
| `lib/api/ads.ts` | 広告。配信は `fetchTargetedAdsV2`(流入元+priority 解決)→ 0119 未適用なら `fetchTargetedAds`(v1 タグ RPC)へ自動 fallback。admin CRUD は `fetchAllAds`/`createAd`/`updateAd`/`deleteAd`/`fetchAdStats` |
| `lib/api/acquisition.ts` | 流入元記録。`captureAcquisitionFromUrl()`(URL の ?traffic_source/?utm_* を sessionStorage に退避)→ サインアップ後 `recordAcquisition()` で `user_acquisition` へ 1 回だけ insert。Native は将来 TODO |
| `hooks/useAdminReports.ts` | `useReportQueue(status)`。React Query で queue 購読 + `admin_notifications` を **1 channel/1 table** で Realtime 購読し、新着 INSERT で queue を invalidate |
| `hooks/useAdmin.ts` | `useIsAdmin()`(`is-admin` query)+ feedback 系 |

`hooks/useAdminReports.ts` は [[Realtime]] の鉄則「1 channel / 1 table」を厳守(channel 名 `admin-feed:notifications`、`admin_notifications` のみ bind)。0121 未適用だと publication が無く CHANNEL_ERROR になるが、その channel が死ぬだけで polling(staleTime 15s)に degrade する設計。

### Realtime 通報通知のフロー

```
ユーザーが通報
  → reports INSERT
  → trigger bump_report_case → report_cases を upsert (新規ケースなら INSERT)
  → trigger notify_admins_on_report_case → admin_notifications へ INSERT
  → (publication 経由) Supabase Realtime push
  → useReportQueue の attachChannel('admin-feed:notifications') が受信
  → qc.invalidateQueries(['admin','report-queue']) で queue 再取得
  → reports.tsx の通報キューが即更新 + バッジ更新
```

※ severity 引き上げ(UPDATE)時の再通知は過剰になるので、まず INSERT のみ通知(0121 のコメント)。複数 admin の個別既読は `admin_notifications.read_by`(jsonb 配列)で表現。

---

## 注意点・地雷

> [!danger] 🔴 migration 0118-0123 は手動適用必須 — Netlify は流さない
> このリポジトリは [[運用 — デプロイ・プレビュー・本番反映確認]] の通り、Netlify が migration を実行しない。0118→0119→0120→0121→0122→0123 を **Supabase SQL エディタで番号順に手動適用**すること(依存があるので順序厳守: 0121/0122 は 0118/0120 に依存、0123 は 0118/0120 に依存)。

> [!warning] silent degrade(fallback)の罠 — 「動いてるけど挙動が変」の真因
> 未適用でもクライアントはクラッシュせず fallback で動くため気付きにくい。症状別の真因:
> - **通報が常に 0 件に見える / 担当・解決ボタンが押せない** → 0118 未適用。`fetchReportQueue` が `get_report_queue`(PGRST202)を捕まえて `fetchReportedPosts`(concern 集計)へ fallback。fallback 時の case は `id='fallback:<post_id>'`・severity 'low' 固定で、`reports.tsx` が `usedFallback` を見てアクションを無効化 + 黄色の注記を出す。
> - **広告が priority 配信されない / 流入元別に出し分かない** → 0119 未適用。`fetchTargetedAdsV2` が新列欠落で throw → `fetchTargetedAds`(v1 タグ配信)へ fallback(DEV では `console.warn('[ads] ... fell back to v1')`)。
> - **措置パネルが空 / strike が常に 0** → 0122 未適用。`EnforcementPanel` の fetch が throw を React Query が握って空表示。`fetchActiveStrikeCount` は失敗時 0 を返す設計(措置 UI をブロックしないため)。
> - **通報通知がリアルタイムで来ない** → 0121 未適用。`admin_notifications` の publication が無く CHANNEL_ERROR → polling に degrade。
>
> → admin 機能が「中途半端に動く」時は、バグを疑う前に **migration 適用状況** を疑う。

### その他の注意

- **`set_admin_role` に自己降格 / 最後の admin 保護ガードは未実装**(★)。複数 admin 前提なら相互復旧できるが、`p_user_id = auth.uid() and p_role <> 'admin'` を弾く堅牢化はレビュー LOW 指摘として未対応。1 人しか admin がいない状態で自分を降格すると復旧不能になりうる。
- **ADMIN_EMAIL がハードコード** (`siturt0330@gmail.com`)。`app/admin/_layout.tsx` と `geek-admin/app/_layout.tsx` の 2 箇所に同じ定数が定義されている。client gate はあくまで UX 用で、本当の権限は DB の `admin_role`/`is_admin()`。RBAC(viewer/moderator)を実運用するなら、この email 一本の client gate と admin_role ベースの server gate が二重基準になっている点に注意。
- **広告のターゲティング解決はクライアント側**(`fetchTargetedAdsV2`)。`ads_select_active` policy で全 authed user が active 広告を直読できる前提で、priority/流入元/タグ交差をクライアントで計算する(RPC 拡張不要にした判断)。配信ロジックを変えるならここ。
- **流入元(user_acquisition)は記録時固定・本人/admin 限定**。UPDATE/DELETE policy を作らない(改ざん防止)。`profiles` に traffic_source 列を足さなかったのは、`profiles_read` が `using(true)`(全員読取可)で列単位プライバシーが守れないため(別テーブル分離で解決 — `docs/ADMIN_CONSOLE.md` §8.11)。
- **既存 `index.tsx` の「通報」タブ(concern 集計)と新 `reports.tsx`(report_cases)は別物**。前者は concern 集計ベースの一覧、後者がリアルタイム/担当/解決のワークフロー。`index.tsx` のタブ内から `/admin/reports` への導線(「優先度キューを開く」)が貼ってある。
- 検索クエリは memory DoS 対策で 200 文字 cap(`SearchInput` の `maxLength={200}`)。

---

## 関連

- [[機能一覧・仕様サマリー]] — Geek 全機能の中での位置づけ
- [[データ層・Supabase・RLS・マイグレーション運用]] — migration 番号順・手動適用・RLS・SECURITY DEFINER の運用
- [[認証・セッション]] — `is_admin()`/`is_moderator()`/`can_view_admin()` と PKCE セッション
- [[匿名性設計と de-anon ホール]] — author_id を admin gate 内でだけ実値で返す判断、一般フィードでの匿名性
- [[Realtime]] — `attachChannel`・1 channel/1 table・publication 登録(admin_notifications)
- [[地雷・落とし穴 総覧]] — silent degrade / fallback の罠
- [[運用 — デプロイ・プレビュー・本番反映確認]] — Netlify は migration を流さない / 本番反映確認
