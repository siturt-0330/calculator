# Admin Console（運営管理ダッシュボード）— 設計ノート

> 本書は運営管理ダッシュボードの **設計ノート 兼 リードエンジニア判断記録** です。
> 指示書（開発タスク）の必須成果物に対応します:
> - §3 調査タスク → 「6. 外部ベストプラクティス調査と取り込み」
> - §6 判断の指針 → 「8. 設計判断ログ」（あいまい点をどう決めたか + 根拠）
> - §7 成果物 → README 相当（「2. 技術選定」「9. セットアップ」）+ 設計ノート（本書全体）
> - §8 進め方 → 「7. 実装計画」（データモデル → リアルタイム通報 → 画面 → 広告）
>
> 最終更新: 2026-06-05 / 担当: リードエンジニア（AI ペアプロ）

---

## 1. エグゼクティブサマリー & スコープ判断

### 1.1 最重要の発見 — 「ゼロから作る」ではなく「8割完成済みを完成させる」

着手前の既存資産調査（4ストリーム並行 + 外部ベストプラクティス調査）の結果、**`geek-v4/app/admin/` に既に約6,000行・10画面の Admin Console が実装済み**であることが判明した。指示書は「新規構築」のトーンだが、実態は大半が実装済みである。

| 指示書の要件 | 既存実装 |
|---|---|
| 4.1 ダッシュボード概要 | ✅ `app/admin/index.tsx`（KPI 6カード + health indicator + 4タブ）|
| 4.2 ユーザー管理 | ✅ `app/admin/index.tsx`（一覧）+ `user/[id].tsx`（詳細・措置）+ `users.tsx`（Shadowban）|
| 4.3 投稿管理 | ✅ `app/admin/index.tsx`（一覧）+ `post/[id].tsx`（詳細・モデレーション）|
| 4.4 通報・モデレーション | ⚠️ 通報キューUI・`moderation_log`は有り。**リアルタイム通知・ケース集約・担当アサイン・異議申立が欠落** |
| 4.5 広告配信 | ⚠️ `ads`/`ad_events`・管理画面・タグターゲティングは有り。**流入元データと流入元別配信が欠落** |
| 5. 認証認可 | ⚠️ `is_admin` gate + RLS は有り。**RBAC（複数ロール）が欠落** |
| 5. セキュリティ | ⚠️ RLS は堅牢。**監査ログの記録漏れ・PIIマスキングが欠落** |

### 1.2 スコープ判断（指示書 §6「実用性最優先」に基づく）

**既存の充実資産を捨てて新規構築するのは実用性に反する。** したがって本作業は **「既存を活かし、指示書の必須要件で本当に欠けている中核部分を埋める」** ことに集中する。埋める対象を価値順に並べると:

1. **【中核・最優先】通報のリアルタイム通知**（指示書 4.4「これは本プロジェクトの中核機能」「通報が入ったらすぐわかるように」）— 既存はポーリングのみ。
2. **【中核】通報ワークフローの本格化** — reports の admin 読み取りRPC・ケース集約・status/担当アサイン・異議申立・**監査ログの完全化**（`suspendUser`等が記録漏れ = コンプラ穴）。
3. **【必須】広告の流入元別配信** — `traffic_source` 列の追加 + サインアップ時の取得 + 流入元別出し分け（指示書 4.5「Google広告 / App Store の2系統」）+ AdSource 抽象化。
4. **【セキュリティ】PII保護** — `phone` が全員SELECT可の懸念を是正 + 表示マスキング。
5. **【拡張】RBAC** — `is_admin` boolean → `viewer / moderator / admin` ロール（後方互換で段階導入）。

この判断と根拠は「8. 設計判断ログ」に詳述する。

---

## 2. 技術選定と理由

| 領域 | 選定 | 理由 |
|---|---|---|
| フロント | **React Native + Expo（既存 geek-v4 に統合）** | 指示書推奨は React+TS。geek-v4 は RN+Expo+TS で Web 出力可能（react-native-web）。既存の `app/admin/*`・`lib/api/*`・`hooks/*`・design tokens を100%再利用できる。**別技術で作り直すと既存6,000行を捨てることになり実用性に反する**。Web ターゲットなので「管理画面＝Web」の要件も満たす。 |
| バックエンド | **Supabase（PostgreSQL + RLS + Edge Functions + Realtime）** | 指示書推奨は Node/NestJS + PostgreSQL。本アプリは既に Supabase で全データ・認証・RLS が稼働中。別バックエンドを立てると二重管理・整合性崩壊を招く。Supabase の RLS は「管理者専用」要件（RBAC・最小権限）を DB レベルで強制でき、むしろ堅牢。 |
| DB | **PostgreSQL（Supabase 管理）** | 指示書推奨どおり。ユーザー・投稿・通報・広告・監査ログは関係が強くRDBが最適。 |
| リアルタイム | **Supabase Realtime（WebSocket ベース）** | 指示書は WebSocket / SSE 推奨。Supabase Realtime は Postgres の変更を WebSocket で push する仕組みで、要件を満たす。既存 `lib/realtime.ts` の `attachChannel`（refCount・channel上限管理）をそのまま使える。SSE 相当を自前実装するより堅牢かつ実績あり。 |
| 認証・認可 | **Supabase Auth (PKCE) + RLS + RBAC（admin_role）** | 既存。RLS で「データに触れるのは適切なロールのみ」を DB が強制。クライアントの gate はUX用で、真の防御はRLS。 |

### 2.1 「別アプリ `geek-admin`」を今は採用しない判断

リポジトリには別アプリ `geek-admin/`（独立 Expo Web アプリ）の scaffold が存在するが、README のステータスに **「ランタイムで React の useState/useEffect が null — 未解決。geek-admin と geek-v4 の node_modules に React が二重に存在し Metro が両方バンドルすると Context が壊れる」** と明記されている。**動かない**。

判断: **本体 `geek-v4/app/admin/` で構築する**（確実に動く・既存資産を再利用・React二重バンドル問題が原理的に起きない）。一般ユーザーへの admin コード露出は (a) ルート遅延ロード (b) RLS による `is_admin()` データ拒否 で実用上の安全を確保する。`geek-admin` の別アプリ分離は将来の最適化課題として「8.8」に保留理由を記録。

---

## 3. 既存資産インベントリ（再利用できるもの）

### 3.1 画面（`app/admin/`）

| ファイル | 役割 | 状態 |
|---|---|---|
| `_layout.tsx` | email gate（`siturt0330@gmail.com`）+ 非adminは`/(tabs)/feed`へredirect | ✅ |
| `index.tsx`（〜1347行） | ダッシュボード: KPI 6カード + health(🟢🟡🔴) + 4タブ（概要/通報/ユーザー/投稿）| ✅ |
| `user/[id].tsx`（〜1167行） | ユーザー詳細: hero + 措置グリッド + 投稿/通報/モデ履歴タブ | ✅ |
| `post/[id].tsx`（〜733行） | 投稿詳細: author + 本文 + 通報者 + モデレーションtimeline | ✅ |
| `users.tsx` | Shadowban 管理 | ✅ |
| `ads.tsx`（〜787行） | 広告管理: 一覧 + status filter + create/edit modal | ✅ |
| `automod.tsx` | AutoMod ルール管理 | ✅ |
| `message/[userId].tsx` | 管理者DM送信 + テンプレ | ✅ |
| `official-apps.tsx` | 公式コミュ申請 inbox | ✅ |
| `support.tsx` | お問い合わせ管理 | ✅ |

### 3.2 API（`lib/api/`）

- `admin.ts`: `fetchAllUsers / fetchAllPosts / suspendUser / deletePost / searchUsers / toggleShadowban / logModeration` 等
- `adminExt.ts`: `fetchAdminDashboardStats / fetchReportedPosts / fetchProblemUsers / fetchModerationLog / fetchUserDetail`
- `ads.ts`: `fetchAllAds / createAd / updateAd / deleteAd / fetchAdStats / fetchTargetedAds / logAdImpression|Click|Dismiss`
- `officialCommunities.ts`: 公式コミュ申請CRUD

### 3.3 データモデル（既存テーブル / migration）

| 対象 | テーブル | migration | 備考 |
|---|---|---|---|
| 通報（ユーザー操作） | `reports` | 0001 | `reporter_id, post_id, reason, created_at`。**INSERT のみ・SELECT policy 無し**（adminは直読不可、集計ビュー経由）|
| 「気になる」 | `concerns` | 0006/0010 | いいねの逆。reports とは別物 |
| アカウント状態 | `profiles.account_state` | 0006 | `healthy/caution/restricted/warned/suspended`、自動計算RPC `refresh_account_state` |
| Shadowban | `profiles.shadowbanned` | 0061 | `author_visible()` で表示制御 |
| 監査ログ | `moderation_log` | 0031 | `admin_id, action(enum), target_type, target_id, reason, metadata, created_at`。**RLS admin限定** |
| 管理者DM | `admin_messages` | 0031 | |
| コミュ通報キュー | `community_resolved_reports` + `get_community_reports` RPC | 0108 | mod限定 |
| AutoMod | `automod_rules` / `automod_log` | 0064 | |
| 広告 | `ads` / `ad_events` | 0035 | `advertiser_name, headline, body, image_url, click_url, target_tags[], exclude_tags[], status, starts_at, ends_at, daily_budget_yen` / events: `impression/click/dismiss` |
| 信頼スコア | `profiles.trust_score` | 0006 + Edge `calculate-trust-score` | |
| admin判定 | `profiles.is_admin` + `is_admin()` | 0012/0027 | boolean単一 |
| Realtime publication | `post_reactions, likes, bbs_replies, comments, notifications, post_added_tags, bbs_threads` | 0050 | concerns/saves は未登録 |

---

## 4. ギャップ分析（指示書要件 — 既存 = 埋めるべき欠落）

### 4.1 【中核】通報・モデレーション

- ❌ **運営者向けリアルタイム通知が無い** — admin 画面はポーリングのみ。指示書 4.4 の中核要件。
- ❌ **`reports` の admin 読み取り手段が弱い** — SELECT policy 無し。admin は `concerns` 集計ビュー経由でしか「通報」を見られず、`reports.reason` が活かされていない。
- ❌ **通報のケース集約が無い** — 同一対象への複数通報を1件に束ねる仕組みが reports 側に無い（指示書「重複対応しないように」）。
- ❌ **status / 担当アサインが無い** — 未対応/対応中/対応完了/却下、担当者割り当て（指示書 4.4 明記）。
- ❌ **異議申し立て（appeal）が無い** — 大規模PFの標準フロー（外部調査トピック1）。
- ❌ **監査ログの記録漏れ** — `suspendUser / deletePost / unsuspendUser` が `logModeration()` を呼んでいない。**「いつ・誰が・どう対応したか」を追跡可能に**（指示書 4.4）という要件に対する重大な穴。

### 4.2 【必須】広告の流入元別配信

- ❌ **流入元（traffic_source）データが一切無い** — `profiles` にも `auth.users` metadata にも install source / referrer / utm が無い。サインアップ時に取得もしていない。
- ❌ **流入元別の出し分けロジックが無い** — `fetch_targeted_ads` はタグのみ。指示書 4.5「Google広告 / App Store 経由ユーザーへの出し分け」が実現不能な状態。
- ❌ **AdSource 抽象化が無い** — 自社/外部ネットワーク/計測 の区別なし。指示書「広告ソースを抽象化し新規追加を容易に」。
- ⚠️ スケジュール自動化・予算消費チェック・差し替え履歴も無い（優先度は中）。

### 4.3 【セキュリティ・認可】

- ❌ **RBAC が無い** — `is_admin` boolean のみ。指示書 5「閲覧オペレーター / モデレーター / 管理者」の例示に未対応。
- ⚠️ **PII**: `profiles.phone` が `profiles_read: using(true)` で全員SELECT可の懸念。指示書「機微情報はマスキング徹底」。

---

## 5. データモデル設計（拡張分）

> 既存テーブルは編集禁止（CLAUDE.md §7 idempotency）。すべて **新規 migration（0118〜番号順）** で `create or replace` / `alter table ... add column if not exists` により追加する。RPC は SECURITY DEFINER + IDOR gate + append-only を厳守（外部調査トピック3 + 既存0113/0115パターン）。

### 5.1 通報ケース（report case）— reports を「対象単位」に集約

外部調査トピック2「同一対象への通報を1ケースに束ね、件数を優先度信号にする」を採用。既存 `reports`（個別通報レコード）は温存し、その上に **集約 + ワークフロー状態** を載せる。

```
report_cases                          -- 対象(投稿/ユーザー)単位の通報ケース
  id                uuid pk
  target_type       text   -- 'post' | 'user' | 'comment'
  target_id         uuid
  status            text   -- 'open' | 'triaged' | 'in_review' | 'resolved' | 'rejected'
  severity          text   -- 'critical' | 'high' | 'medium' | 'low'（カテゴリ由来）
  priority_score    numeric-- f(severity, report_count, recency) で算出（外部調査T2）
  report_count      int    -- 束ねた通報数（reports から集計）
  reasons           text[] -- 通報理由の集合
  assignee_id       uuid   -- 担当モデレーター（null=未アサイン）
  first_reported_at timestamptz
  last_reported_at  timestamptz
  resolved_by       uuid
  resolved_at       timestamptz
  resolution        text   -- 'content_removed' | 'user_actioned' | 'no_action' | 'duplicate'
  unique(target_type, target_id) where status != 'resolved'  -- 未解決は1対象1ケース
```

- 状態機械（外部調査トピック1）: `open → triaged → in_review → resolved | rejected`。遷移は必ず `moderation_log` に記録。
- 優先度: `critical` はスコアに関係なくキュー最上位（ハードルール）。
- admin読み取りは **`get_report_queue()` RPC**（admin/moderator限定, SECURITY DEFINER）で `reports` を集約して返す（SELECT policy が無い問題を RPC で解決）。

### 5.2 段階的措置（progressive enforcement）+ strike

外部調査トピック4（YouTube/TikTok型: 警告→機能制限→一時停止→永久BAN、各strikeは90日失効、重大違反は即時最上位）。

```
enforcement_actions                   -- ユーザーへの措置履歴（append-only）
  id            uuid pk
  user_id       uuid   -- 対象ユーザー
  level         int    -- 0:warning 1:feature_limit 2:temp_suspension 3:permanent_ban
  scope         text   -- 'global' | 'post' | 'comment' | 'dm'（機能粒度の制限）
  reason        text
  policy_ref    text   -- 適用ルール（statement of reasons 用）
  issued_by     uuid   -- 実行モデレーター
  issued_at     timestamptz
  expires_at    timestamptz  -- 一時措置/strikeの失効（issued+90d 等）。null=恒久
  linked_case_id uuid  -- 発端の report_case
  appeal_id     uuid   -- 異議申立への参照（あれば）
```

- 有効strike数 = `expires_at > now()` の件数 → 次の措置レベルを自動算出。
- `account_state` への反映はトリガ or RPC で同期（既存の自動計算とは別に、admin の明示措置を上書きできる）。

### 5.3 異議申し立て（appeal）

外部調査トピック1「appealは元判定に紐づく再審査イベント」。専用テーブルにせず `enforcement_actions.appeal_id` + 軽量 `appeals` で表現。

```
appeals
  id            uuid pk
  action_id     uuid   -- 対象の enforcement_action
  user_id       uuid   -- 申立者（=対象ユーザー本人のみ）
  message       text   -- 申立内容
  status        text   -- 'pending' | 'approved' | 'denied'
  reviewed_by   uuid
  reviewed_at   timestamptz
  decision_note text
  created_at    timestamptz
```

### 5.4 監査ログの完全化

既存 `moderation_log`（0031）を **append-only として厳格化**（外部調査トピック3）+ API層の記録漏れを塞ぐ。

- DB: `moderation_log` への UPDATE/DELETE を RLS で全ロール拒否（INSERT のみ）。
- API: `suspendUser / deletePost / unsuspendUser / toggleShadowban / 措置 / ケース解決` の全 mutation で `logModeration()` を必須呼び出し（CIで grep チェックも検討）。
- 項目: `actor_id / action / target_type / target_id / before_state → after_state / reason / policy_ref / created_at`（4必須軸 Who/What/When/Outcome を満たす）。

### 5.5 流入元（traffic source）

> **実装時の判断変更（§8.11）: profiles 列 → 別テーブル `user_acquisition`。**
> 既存 `profiles_read` が `using(true)`（全員読取可）で**列単位のプライバシー保護ができない**ため、
> 流入元は別テーブルに分離し RLS で本人+admin限定にした（migration 0119 で実装済）。

```
user_acquisition（本人+admin限定 RLS、改ざん防止のため UPDATE/DELETE policy なし）:
  user_id        uuid pk → auth.users
  traffic_source text  -- 'google_ads' | 'app_store' | 'play_store' | 'organic' | 'referral' | 'other'
  utm_source / utm_medium / utm_campaign  text
  acquired_at    timestamptz
```

- 取得経路: Web は URL クエリ（`?utm_source=...&traffic_source=google_ads`）を サインアップ前に sessionStorage 保存 → signup 直後にクライアントが `user_acquisition` へ insert（本人のみ insert 可）。Native は deep link / Universal Links。
- **プライバシー**: 本人 + admin のみ SELECT（`ua_self_or_admin_select`）。一般公開しない。

### 5.6 広告ソース抽象化 + 流入元ターゲティング

外部調査トピック5（Google Ad Manager の priority ティア: Sponsorship=4 > Standard=6/8/10 > Network=12 > House=16。小さいほど優先）。

```
ads に列追加（alter add column if not exists）:
  source_type      text   default 'house'  -- 'house'(自社) | 'network'(外部:AdMob等) | 'sponsorship'(直販)
  priority         int    default 16        -- 小さいほど優先（GAM体系を縮小移植）
  target_traffic_sources text[]            -- 流入元ターゲティング（空=全員）
  network_code     text                    -- 外部ネットワーク識別（将来拡張）
  frequency_cap    int                     -- 同一ユーザー表示上限（将来）
```

- 配信ロジック: 「ターゲティング適合（タグ ∩ traffic_source）∩ 配信期間内 ∩ status=active」の候補を `priority` 昇順で選択、同点は既存のタグスコア。最後に `house` がフォールバック。
- `fetch_targeted_ads` を拡張 or 新 `fetch_ads_v2(p_traffic_source, ...)`。**未適用環境では既存RPCにフォールバック**（CLAUDE.md §11）。
- 「Google広告枠」= `source_type='network', network_code='admob'` の予約、「App Store流入向け」= `target_traffic_sources @> {app_store}` で表現。指示書の初期2系統を抽象モデルで自然に表現できる。

### 5.7 RBAC（admin_role）

```
profiles に列追加:
  admin_role  text default 'none' check (admin_role in ('none','viewer','moderator','admin'))

is_admin() を後方互換で再定義:
  select admin_role = 'admin' (既存 is_admin=true は migration で admin_role='admin' に移送)
新ヘルパ: is_moderator() = admin_role in ('moderator','admin')
         can_view_admin() = admin_role in ('viewer','moderator','admin')
```

権限マトリクス（抜粋）:

| 操作 | viewer | moderator | admin |
|---|---|---|---|
| ダッシュボード/一覧の閲覧 | ✅ | ✅ | ✅ |
| 投稿の非公開/削除 | ❌ | ✅ | ✅ |
| ユーザー措置（警告/凍結/BAN） | ❌ | ⚠️一時のみ | ✅ |
| 広告入稿/配信 | ❌ | ❌ | ✅ |
| ロール変更 | ❌ | ❌ | ✅ |
| PII（phone等）の閲覧 | マスク | マスク | 実値 |

### 5.8 運営者向けリアルタイム通知

既存 `notifications` + Realtime publication を転用。

- 新規 `admin_notifications`（または `notifications.audience='admin'` 拡張）テーブル。`report_case` の INSERT/重要遷移をトリガで投入。
- Realtime: `attachChannel('admin-feed', ...)` で `admin_notifications` を購読（publication 登録が必要 = migration）。
- UI: ダッシュボードの「未対応通報」バッジをリアルタイム更新 + トースト + （任意）通知音。

---

## 6. 外部ベストプラクティス調査と取り込み（指示書 §3 必須）

大規模プラットフォーム（Meta / YouTube / TikTok / Google Ad Manager）の**公開情報**を調査し、本アプリ規模に落とし込んだ。出典は各項末尾。

### 6.1 モデレーションのワークフロー（→ 5.1/5.3 に反映）
- 標準ライフサイクル: **通報受付 → トリアージ → 審査 → 判定 → 措置 → 理由通知 → 異議申立**の6段。intakeは「ユーザー通報」と「自動検知」の両入口。
- 取り込み: `report_cases` に状態機械を持たせ、遷移を監査ログ化。措置に「理由（statement of reasons）」を構造化フィールドで保持。appealは元判定に紐づく再審査イベントとして設計。
- 出典: Stream（Moderation Appeals & Transparency）, TSPA（User Appeals）, Microsoft Digital Safety。

### 6.2 通報キューの優先度・重複集約（→ 5.1 に反映）
- Meta は時系列処理を廃止し、**virality / severity / 違反likelihood** の合成でキューを並べ替え「最悪を最初に」。severity階層（Critical/High/Medium）。Critical はキューを飛び越える。同一対象は集約。queue depth / age を SLA 指標化。
- 取り込み: `priority_score = f(severity, report_count, recency)`、`critical` はハードルールで最上位、`report_cases` で対象単位集約、ダッシュボードに queue depth/age を出す。
- 出典: Social Media Today（Facebook prioritizes worst-case first）, Moderation API, arXiv QUEST。

### 6.3 監査ログ（→ 5.4 に反映）
- 4必須軸 **Who / What / When / Outcome**。匿名エントリ禁止。**改ざん耐性（append-only / immutable）**必須。保持期間は規制依存（最低1年目安）。
- 取り込み: `moderation_log` を INSERT-only に RLS 強化、`before→after` 状態、`actor_id` 必須、API全mutationで記録。
- 出典: Kiteworks（Audit Log）, ISO 27002, TSPA（QA）。

### 6.4 段階的措置・strike（→ 5.2 に反映）
- YouTube: 初回は警告（罰なし）→ 3-strike（1週→2週→永久）、**各strikeは90日失効**、重大違反は即termination。TikTok も同型 + **ban evasion 明示禁止**。
- 取り込み: `enforcement_actions` を強度ladder（0〜3）+ `expires_at`（issued+90d）、有効strike数で次レベル自動算出、重大違反の即時最上位バイパス、ban evasion を将来シグナルとして設計に明記。
- 出典: YouTube Help（strike basics）, Google Transparency Report, TikTok Newsroom / Community Guidelines。

### 6.5 広告配信・ソース抽象化（→ 5.6 に反映）
- パイプライン: **入稿 → 審査 → ターゲティング → 配信制御（flight/pacing/priority/frequency cap）→ 計測**。
- **Google Ad Manager の priority ティア（Sponsorship=4 > Standard=6/8/10 > Network/Price/Bulk=12 > House=16、小さいほど優先）** がソース抽象化の決定版。外部ネットワークは mediation/waterfall。一次creative失敗時はhouseへフォールバック。
- 取り込み: `ads.source_type ∈ {house, network, sponsorship}` + `priority`(数値) + `target_traffic_sources`。house を最低優先フォールバックに常設。creative にも審査ステートを持たせモデレーションと共通化。
- 出典: Google Ad Manager Help（Line item types and priorities / Sponsorship）, AdMob Help（mediation）, AdPersonam / SmartyAds / Epom（ad server）。

### 6.6 横断的示唆
- **モデレーションと広告審査は同型のレビュー基盤**（`pending → in_review → decided(approved/rejected+理由) → appeal` + append-only監査ログ）で統一できる。
- **優先度ティアは両ドメイン共通の発想**（小さい番号=最優先 + ハードルールバイパス）。

---

## 7. 実装計画（指示書 §8 の推奨順 = データモデル → リアルタイム通報 → 画面 → 広告）

各段階で「動く状態」を保ち、ローカル commit を積む（**push/PR/merge はユーザー明示指示時のみ** — CLAUDE.md §0 厳守）。

- **フェーズ0（完了）**: 既存資産調査・外部調査・設計ノート確定（本書）。
- **フェーズ1**: データモデル migration（番号順・冪等・RLS・IDOR gate）
  - 1a. `report_cases` + `get_report_queue()` RPC + 集約トリガ
  - 1b. `moderation_log` append-only 強化 + API記録漏れ修正
  - 1c. `traffic_source` 列 + RLS + サインアップ取得
  - 1d. `ads` 抽象化列（source_type/priority/target_traffic_sources）+ 配信RPC拡張
  - 1e. `admin_notifications` + publication + トリガ
  - 1f. `admin_role`（RBAC）+ `is_admin()` 後方互換再定義
  - 1g. `enforcement_actions` + `appeals`
- **フェーズ2（中核）**: 通報リアルタイム通知 — `admin_notifications` 購読 hook + ダッシュボードのバッジ/トースト即時更新
- **フェーズ3**: 管理画面の不足補完 — 通報キュー（ケース/status/担当/集約）、ユーザー一覧フィルタ、PIIマスキング表示
- **フェーズ4**: 広告 — 流入元別配信 + AdSource抽象化のUI、サインアップ流入取得
- **フェーズ5**: シードデータ（ダミーユーザー/投稿/通報/広告）+ README統合 + 検証

**各フェーズ末で `npm run type-check` / `npm run lint` を通す。migration は Supabase SQL editor 手動適用前提（Netlifyは流さない）で、未適用でもクライアントが fallback で動くこと（CLAUDE.md §11）。**

---

## 8. 設計判断ログ（あいまい点をどう決めたか + 根拠）

指示書 §6 の優先順位（①実用性 ②大規模PFベストプラクティス ③セキュリティ・プライバシー ④拡張性。対立時は安全性優先）に従って決定した。

| # | 論点 | 判断 | 根拠（優先順位） |
|---|---|---|---|
| 8.1 | 新規構築 vs 既存拡張 | **既存拡張** | ①実用性: 6,000行の動く資産を捨てない。④拡張性も既存パターンで担保。 |
| 8.2 | 技術スタック（指示書はNode/NestJS推奨） | **既存 Supabase + RN/Expo Web** | ①実用性: 既存統合。③RLSがRBAC/最小権限を強制でき安全。 |
| 8.3 | 別アプリ geek-admin | **採用せず、本体 app/admin で構築** | ①実用性: geek-admin は React二重バンドルで動作不能（README明記）。深追いは時間浪費。 |
| 8.4 | 通報データ構造 | **既存 reports 温存 + report_cases で集約** | ②PFベストプラクティス（集約）。①既存破壊を避ける。 |
| 8.5 | 監査ログ | **append-only 強化 + 全mutation記録必須化** | ③セキュリティ最優先。②ISO/TSPA準拠。「いつ誰がどう対応したか追跡」要件。 |
| 8.6 | PII（phone） | **本人+admin限定RLS + viewer/moderatorにはマスク** | ③プライバシー最優先（指示書「マスキング徹底」）。 |
| 8.7 | RBAC導入方法 | **admin_role を後方互換で段階導入（is_admin維持）** | ④拡張性 + ①既存コード非破壊。 |
| 8.8 | 広告ソース | **GAM priority ティアを縮小移植 + traffic_source** | ④拡張性（新ソース追加容易）。②PFベストプラクティス。指示書の初期2系統を抽象モデルで表現。 |
| 8.9 | リアルタイム手段 | **Supabase Realtime（WebSocket）** | ①実用性（既存attachChannel）。指示書のWebSocket/SSE推奨に合致。 |
| 8.10 | 措置の段階設計 | **strike ladder + 90日失効 + 重大即BANバイパス** | ②YouTube/TikTok型。③安全（重大違反の即時対応）。 |
| 8.11 | 流入元の保存先 | **profiles 列でなく別テーブル `user_acquisition`** | ③プライバシー最優先: 既存 `profiles_read=using(true)` では列単位保護不可。別テーブルRLSで本人+admin限定。①既存破壊なし（profiles_read 不変）。 |
| 8.12 | `suspendUser`等の reason引数 | **引数追加せず metadata の from→to で記録** | ①実用性: `useMutation({mutationFn})` 直渡し互換を維持（第2引数は React Query の context と型衝突）。 |
| 8.13 | RBAC/admin_notifications の分割 | **0118→0119(流入元/広告)→0120(RBAC)→0121(通知) に分割** | ③安全: RBAC は guard_profile_update(0105) との整合精読が必要。通報基盤を先に固め、段階適用。 |

---

## 9. セキュリティ・プライバシー方針

- **最小権限**: RBAC（admin_role）で操作を役割制限。RLS で DB レベル強制。クライアント gate はUX用、真の防御はRLS。
- **PII保護**: `phone` 等は本人+admin限定 RLS、viewer/moderator には `[REDACTED]` マスク表示。パスワード/決済の生データは扱わない（auth schema内に隔離）。
- **監査**: 全モデレーション操作を append-only `moderation_log` に記録。改ざん不可（UPDATE/DELETE をRLSで拒否）。
- **入力検証**: 外部入力（URL等）は `sanitizeUrl` / SSRF対策。広告 click_url も検証。
- **IDOR/認可**: 新RPCは `p_user_id <> auth.uid()` gate + SECURITY DEFINER + 可視性述語再適用（既存0113/0115パターン）。
- **匿名性**: 投稿の匿名性ホール（memory既知）を再現しないよう、admin RPC でも author_id 露出は admin/moderator のみに限定（一般ユーザー向けRPCのマスクは維持）。

---

## 10. 成果物チェックリスト（指示書 §7）

- [x] 設計ノート（本書）— モデレーション/広告設計の根拠 + 参考PF知見
- [x] 動作するソースコード（フェーズ1〜4 + 既存 admin 10画面）
  - migration: `0118_report_cases` / `0119_traffic_source_and_ads` / `0120_admin_rbac` / `0121_admin_notifications`
  - lib/api: `admin.ts`(監査ログ修正) / `adminReports.ts` / `ads.ts`(v2) / `acquisition.ts`
  - hooks: `useAdminReports.ts`
  - 画面: `app/admin/reports.tsx`(通報キュー) / `ads.tsx`(入稿UI拡張) / `index.tsx`(導線)
  - signup 流入取得: `app/(auth)/signup.tsx`
- [x] README（セットアップ/技術選定/機能一覧）→ 本書 §11
- [x] シードデータ → `scripts/seed_admin_console.sql`

---

## 11. セットアップ & 運用（README 相当）

### 11.1 技術選定（要約 / 詳細は §2）
- フロント: 既存 `geek-v4`（React Native + Expo + TS, Web 出力）の `app/admin/` に統合。
- バックエンド: Supabase（PostgreSQL + RLS + Edge + Realtime）。RLS が RBAC/最小権限を DB で強制。
- リアルタイム: Supabase Realtime（WebSocket）。`lib/realtime.ts` の `attachChannel`。

### 11.2 機能一覧
| 領域 | 実装 |
|---|---|
| ダッシュボード概要 | `app/admin/index.tsx`（KPI + health + 通報/ユーザー/投稿タブ）|
| ユーザー管理 | `index.tsx`(一覧) + `user/[id].tsx`(詳細・措置) + `users.tsx`(Shadowban) |
| 投稿管理 | `index.tsx`(一覧) + `post/[id].tsx`(詳細・モデレーション) |
| 通報キュー（中核） | `reports.tsx` + `useReportQueue` + `report_cases`/`get_report_queue` |
| リアルタイム通報通知 | `admin_notifications` + publication + `admin-feed` 購読 |
| 監査ログ | `moderation_log`（append-only）+ 全 mutation 記録 |
| 広告配信 | `ads`/`ad_events` + `fetchTargetedAdsV2`（流入元別）+ `ads.tsx`(入稿) |
| 流入元計測 | `user_acquisition` + `acquisition.ts`（signup 取得）|
| RBAC | `admin_role`（viewer/moderator/admin）+ `is_admin()`/`is_moderator()` |

### 11.3 セットアップ手順
1. **migration を順に Supabase SQL editor で適用**: `0118` → `0119` → `0120` → `0121`
   （Netlify は migration を流さないため手動。各ファイル冒頭コメント参照。未適用でも
   クライアントは fallback で動作する＝段階適用が安全）。
2. **シード投入**（任意・動作確認用）: `scripts/seed_admin_console.sql` を SQL editor で実行
   （ユーザー/投稿 seed が無ければ先に `seed_dummy_v2.sql`）。
3. **管理者付与**: `select set_admin_role('<user_uuid>', 'admin');`（既存 `is_admin=true` は 0120 で自動移送）。
4. **起動**: `npm run web`（既存 geek-v4 と同じ）。`/admin` に URL 直打ちで到達（email gate + RLS）。

### 11.4 既知の制約・今後のTODO
- ~~**AdCard 配線**~~: ✅ 完了。`hooks/useFeed.ts` の広告取得を `fetchTargetedAdsV2` に切替済
  （流入元別配信が実フィードに反映。0119未適用時は v1 へ内部fallback）。
- **流入元取得**: 現状 signup 画面 mount で URL クエリを capture。ルート経由の確実な取得は
  `app/_layout.tsx` 起動時 capture が将来TODO（§5.5）。
- **RBAC Phase2**: 個別 RLS / `report_cases` を `is_moderator()` に開放（現状は admin gate）。
- **PII マスキング**: viewer/moderator 向けの `phone` 等のマスク表示は UI 側で今後適用。
- **異議申し立て(appeals) / strike(enforcement_actions)**: データモデルは §5.2/§5.3 で設計済、
  migration 実装は次フェーズ。
