# GEEK v4 — デプロイ Runbook

最終更新: 2026-05

3 つの配信先 (Web / iOS / Android) と Supabase バックエンドの本番反映手順をまとめる。
**「いつでもこの順に踏めばリリースできる」** 状態を維持するのが目的。

---

## 0. 共通: 事前チェック (毎回)

```bash
npm ci
npm run type-check        # tsc --noEmit
npm test -- --ci          # unit tests
```

3 つとも green でない限りデプロイしない。CI (`.github/workflows/ci.yml`) でも自動実行されるが、ローカルでも確認。

### 環境変数の置き場所

| 変数 | クライアント側 | Web (Netlify) | iOS/Android (EAS) | サーバー (Supabase) |
|---|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ ローカル `.env` | ✅ Site settings → env | ✅ `eas.json` build.env or `eas secret:create` | — |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ ローカル `.env` | ✅ | ✅ | — |
| `EXPO_PUBLIC_SENTRY_DSN` | ✅ ローカル `.env` | ✅ | ✅ | — |
| `EXPO_PUBLIC_POSTHOG_KEY` | ✅ ローカル `.env` | ✅ | ✅ | — |
| `EXPO_PUBLIC_VAPID_PUBLIC_KEY` | ✅ ローカル `.env` (Web のみ) | ✅ | — | — |
| `VAPID_PRIVATE_KEY` | ❌ 絶対に置かない | ❌ | ❌ | ✅ `supabase secrets set` |
| `ANTHROPIC_API_KEY` (将来) | ❌ | ❌ | ❌ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ | ❌ | ❌ | Edge Function 内自動付与 |

**ルール**: `EXPO_PUBLIC_*` prefix のものはバンドルに同梱される = ブラウザ DevTools で読まれる前提。RLS 前提で安全な anon key と DSN だけ。秘密鍵を `EXPO_PUBLIC_*` に置いたら即時 rotate。

---

## 1. Supabase (DB / Functions)

### マイグレーション適用

```bash
# ローカル → リモートの diff 確認
supabase db diff --linked

# 適用
supabase db push --linked

# 適用後、複製ファイルを supabase/migrations/ に commit する
```

### Edge Function デプロイ

```bash
supabase functions deploy check-content       --no-verify-jwt
supabase functions deploy calculate-trust-score
supabase functions deploy push-send
# 他、supabase/functions/ 配下のすべて
```

### secrets 更新

```bash
supabase secrets set VAPID_PRIVATE_KEY=...   --linked
supabase secrets list --linked
```

### Rollback

- マイグレーション: 当該 migration を打ち消す reverse SQL を新規 `00xx_revert_*.sql` として追加して再 `db push`。**既存 migration ファイルの編集禁止** (idempotency 崩壊)。
- Edge Function: `supabase functions deploy <name>` で 1 つ前のソースを再 deploy。

---

## 2. Web (Netlify)

### 通常リリース

1. master / main に merge。
2. Netlify が `netlify.toml` の `command = "npm ci && npm run build:web"` を実行。
3. `dist/` 配下を CDN にデプロイ。

### env 設定 (初回のみ)

Netlify Site settings → Environment variables で以下を設定:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SENTRY_DSN`
- `EXPO_PUBLIC_POSTHOG_KEY`
- `EXPO_PUBLIC_POSTHOG_HOST`
- `EXPO_PUBLIC_VAPID_PUBLIC_KEY`

### 確認

- Deploy log で `npm run build:web` が exit 0 を返していること
- `https://<your-site>.netlify.app/` で起動を確認
- Sentry / PostHog で event が流れていること (本物の DSN/KEY が刺さっていれば)

### Rollback

Netlify Dashboard → Deploys → 過去 deploy の "Publish deploy" ボタン。SPA fallback が効いているので URL は壊れない。

---

## 3. iOS (App Store / TestFlight)

### 初回セットアップ

```bash
# Apple Developer プログラム加入 (年間 $99)
# App Store Connect で App ID 登録 (bundle ID: app.geek.v4)
# eas login
eas device:create                   # internal distribution 用
```

### eas.json の submit.production を埋める

`eas.json` の現状:

```jsonc
"submit": { "production": {} }
```

これを下記で置換 (実値は EAS Secret に置くと安全):

```jsonc
"submit": {
  "production": {
    "ios": {
      "appleId": "<APPLE_DEVELOPER_EMAIL>",
      "ascAppId": "<APP_STORE_CONNECT_APP_ID>",
      "appleTeamId": "<APPLE_TEAM_ID>"
    },
    "android": {
      "serviceAccountKeyPath": "./google-service-account.json",
      "track": "internal"
    }
  }
}
```

### Build → Submit

```bash
eas build --platform ios --profile production
# build 完了後の URL から .ipa を確認
eas submit --platform ios --latest
```

App Store Connect で TestFlight → 内部テスト → 外部審査の流れ。

### 審査用情報

`docs/STORE_REVIEW.md` に reviewer 用テストアカウント / デモフローを記載。提出時にコピペする。

### Privacy Manifest

`app.json` の `ios.privacyManifests` に集約済 (iOS 17+ 必須)。新規 third-party SDK を追加した場合は **その SDK 自身の PrivacyInfo.xcprivacy** が同梱されているかを確認 (主要 Expo / RN ライブラリは対応済)。

### Rollback (TestFlight 配信中)

- TestFlight: 旧バージョンを再有効化
- App Store: 「Expedited Review」で hotfix 申請 (もしくは「Remove from sale」で一時退避)

---

## 4. Android (Google Play)

### 初回セットアップ

```bash
# Google Play Console 開発者登録 ($25 一回)
# サービスアカウント発行 → google-service-account.json をプロジェクト直下に置く
#   (.gitignore に追加すること!)
```

### Build → Submit

```bash
eas build --platform android --profile production
eas submit --platform android --latest --track internal
# Closed → Open → Production の順で track を昇格
```

---

## 5. OTA Update (Web 以外で hotfix)

JS-only な修正なら EAS Update で即配信できる (ストア審査不要)。Native module の変更を含む場合は通常の Build & Submit が必要。

```bash
eas update --branch production --message "fix: <概要>"
```

---

## 6. リリース前最終チェックリスト

- [ ] `npm run type-check` green
- [ ] `npm test` green
- [ ] Supabase migrations push 済 (`supabase db diff --linked` が空)
- [ ] Sentry DSN / PostHog key を全環境に設定
- [ ] EAS secrets (`eas secret:list`) に必要な値が揃っている
- [ ] `app.json` の `version` / `ios.buildNumber` / `android.versionCode` をインクリメント
- [ ] App Store / Play Store の screenshots / description を更新
- [ ] `docs/STORE_REVIEW.md` の reviewer ノートが最新
- [ ] `.env` / `google-service-account.json` が `.gitignore` 済 (commit されていないこと)
- [ ] 過去 24h の Sentry / Supabase error rate が定常範囲

---

## 7. インシデント時

1. **検知**: Sentry alert / Supabase ダッシュボード / ユーザー報告
2. **影響範囲確認**: 何 % のユーザーに / どの platform で / いつから
3. **判断**:
   - JS のみで直る → EAS Update で hotfix
   - Native も触る → 緊急 EAS Build + Expedited Review 申請
   - 即時止めるべき → Web は Netlify rollback、Native は Play / TestFlight で旧版に戻す
   - DB 起因 → migration の revert SQL を即作って `db push`
4. **post-mortem**: `docs/HYPOTHESIS_LOG.md` に記録
