# Geek Admin — 開発者専用顧客管理ツール (別アプリ)

これは Geek (`../geek-v4/`) と**完全に分離**された独立 Expo Web アプリです。

## 構成イメージ

```
worktrees/cranky-heisenberg-669910/
├── geek-v4/         ← ① カスタマー用アプリ (ユーザー向け Geek SNS)
├── geek-admin/      ← ③ 開発者用アプリ (このディレクトリ — 顧客管理)
└── (geek-official/) ← ② 公式用アプリ (未実装 / 今後)
```

`geek-admin` の特徴:
- 独自の `package.json` / `app.json` / Metro / Babel / TypeScript 設定
- 独自のビルド出力 (`dist/`) — 別 Netlify サイトに独立デプロイ可能
- 自前のログイン画面 (`siturt0330@gmail.com` のみ許可)
- 管理画面コードは `geek-v4/app/admin/*` から re-export して共有

## ステータス

- [x] ディレクトリ構造作成
- [x] `package.json` / `app.json` / `babel.config.js` / `tsconfig.json` 設定
- [x] Metro 設定 (watchFolders で `geek-v4` を監視)
- [x] `app/_layout.tsx` (プロバイダー + AdminLogin)
- [x] `app/index.tsx` 等の re-export shells
- [x] TypeScript チェック clean
- [x] `npm install` 完了
- [x] ビルド成功 (`expo export -p web`)
- [ ] **ランタイムで React の useState/useEffect が null** — 未解決
  - 原因: `geek-admin` と `geek-v4` の `node_modules` に React が二重に存在し
    Metro が両方をバンドルすると React Context が壊れる
  - Metro の `extraNodeModules` で `react` / `react-native` 等を `geek-v4`
    側に強制マップしても、生成バンドルが同一ハッシュ (= 効いていない)
  - 次の試行候補:
    1. `geek-admin/node_modules/react*` 系を物理削除して `geek-v4` のみ参照させる
    2. npm workspaces 化して `geek-v4` を hoisted dep にする
    3. 管理画面コードを `geek-admin/app/` に直接コピー (re-export ではなく duplicate)

## ローカル起動

```bash
cd geek-admin
npx expo start --web  # 開発
npx expo export -p web --output-dir dist  # 本番ビルド
npx serve dist -s -l 9126  # 静的サーブ
```

## 環境変数

`.env` に Supabase の URL/anon key が必要 (geek-v4 と同じものをコピー):

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## ログイン

ビルド済みアプリにアクセスすると AdminLogin 画面が表示されます。
`siturt0330@gmail.com` でログインすると admin dashboard へ遷移します。
それ以外のアカウントはサーバー側 RLS (`is_admin()`) でデータ取得が拒否されます。
