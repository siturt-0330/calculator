# Universal Links / App Links 設定ガイド

パスワードリセット等のメールリンクは `geek://` カスタムスキームではなく
**HTTPS の Universal Links (iOS) / App Links (Android)** で受ける構成に統一した。

カスタムスキームを使い続けると、悪意あるアプリが同じ scheme を登録して
recovery token を奪う「URL scheme hijacking」が成立しうるため。

## 全体像

```
メール (https://geek.app/reset-password?code=xxx)
   ↓
端末で開く
   ├── アプリがインストール済 & 検証成功 → アプリで直接開く (iOS/Android)
   └── アプリ未インストール / 検証失敗   → ブラウザで web 版が開く
```

iOS は **associatedDomains** + Apple サーバ側の検証
Android は **intentFilters + autoVerify** + `assetlinks.json` ホスティング

## iOS 設定 (Associated Domains)

すでに `app.json` で設定済:

```json
"ios": {
  "associatedDomains": ["applinks:geek.app"]
}
```

追加で必要なのは Apple Developer 側の設定:

1. Apple Developer Portal → Certificates, Identifiers & Profiles
2. App ID `app.geek.v4` を開く
3. Capabilities で **Associated Domains** を有効化
4. プロビジョニングプロファイルを再生成・ダウンロード

そして `https://geek.app/.well-known/apple-app-site-association` を配信:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<TEAM_ID>.app.geek.v4",
        "paths": [
          "/reset-password*",
          "/community/*",
          "/post/*"
        ]
      }
    ]
  }
}
```

注意点:
- **拡張子なし** (`apple-app-site-association` で正解)
- **Content-Type: application/json** で配信
- **HTTPS 必須** (HTTP 不可)
- **リダイレクト不可** (Apple は 200 OK 直接応答だけ受け付ける)

Netlify で配信する場合は `geek-v4/public/.well-known/apple-app-site-association`
に配置し、`netlify.toml` で content-type を上書き:

```toml
[[headers]]
  for = "/.well-known/apple-app-site-association"
  [headers.values]
    Content-Type = "application/json"
```

## Android 設定 (App Links + Digital Asset Links)

すでに `app.json` で設定済:

```json
"android": {
  "intentFilters": [
    {
      "action": "VIEW",
      "autoVerify": true,
      "data": [{ "scheme": "https", "host": "geek.app", "pathPrefix": "/" }],
      "category": ["BROWSABLE", "DEFAULT"]
    }
  ]
}
```

追加で必要なのは `https://geek.app/.well-known/assetlinks.json` の配信:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.geek.v4",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:DD:..."
      ]
    }
  }
]
```

`sha256_cert_fingerprints` は EAS Build で生成された署名鍵の SHA-256 ハッシュ:

```bash
eas credentials  # → Android → Production → Keystore → Show
# Showing "SHA256 Fingerprint" をコピー
```

確認:

```bash
# Google が認識しているかチェック
curl https://digitalassetlinks.googleapis.com/v1/statements:list \
  -H "Content-Type: application/json" \
  --data-urlencode 'source.web.site=https://geek.app' \
  --data-urlencode 'relation=delegate_permission/common.handle_all_urls'
```

## Supabase 側の Redirect URLs 設定

Supabase Dashboard → Authentication → URL Configuration → Redirect URLs:

```
https://geek.app/reset-password
https://geek.app/auth/callback
https://*.geek.app/reset-password
http://localhost:8081/reset-password   (開発用)
http://localhost:19006/reset-password  (開発用)
```

ここに登録されていない URL は Supabase が拒否するため、リダイレクト URL を
変更したら必ず Dashboard 側も合わせること。

## デバッグ

iOS:
- Safari でメールリンクをタップ → アプリが起動する場合は OK
- アプリが開かず Safari にとどまる場合は AASA ファイル配信を確認
- Settings → Developer → Universal Links 一覧で対象 app の検証状態を見る

Android:
- `adb shell pm get-app-links app.geek.v4` でドメイン検証状態を確認
- `verified` でなければ assetlinks.json をチェック
- `adb shell am start -a android.intent.action.VIEW -d "https://geek.app/reset-password" app.geek.v4` でテスト

## ロールアウト計画

1. `apple-app-site-association` と `assetlinks.json` を本番に配信
2. アプリの新バージョン (Universal Links 対応) をストア審査に提出
3. 旧バージョン (`geek://` のみ) のユーザー向けは Supabase 側で当面両方の
   Redirect URLs を許可しておく
4. 新バージョン普及後 (1〜2 ヶ月) に `geek://` を Supabase の許可リストから除外
