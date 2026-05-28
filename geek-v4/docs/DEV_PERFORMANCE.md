# DEV_PERFORMANCE.md — Dev server 起動を速くする

> Windows + OneDrive 環境で Expo / Metro が遅い真因は **OneDrive 同期 + Windows Defender** が `node_modules` 配下 (約 30k+ ファイル) を全部スキャンしていること。
> このドキュメントの 3 段階の除外設定で **dev server cold start を体感 2-4x 高速化**できる。

---

## 1. `.watchmanconfig` (リポジトリにコミット済)

`geek-v4/.watchmanconfig` に以下を配置:

```json
{
  "ignore_dirs": [
    "node_modules",
    "dist",
    ".expo",
    ".git",
    "android/build",
    "ios/build",
    "supabase/.temp"
  ]
}
```

- watchman / Metro file watcher が `node_modules` 配下を **inotify / RDCW 監視対象から外す**。
- これだけで `npm start` の "Starting Metro Bundler" 後の初回 transform が体感速くなる (target: 30s → 10-15s)。
- **コミットして OK** (チーム共通設定。チームメンバーが macOS / Linux でも有効)。

> 注意: `.watchmanconfig` は **プロジェクトルート (geek-v4/) に置く**。`geek-v4/app/` 等の subdir に置くと効かない。

---

## 2. Windows Defender 除外 (★ 手動・admin PowerShell)

Defender のリアルタイム保護が `node_modules` の全 .js を毎回スキャンするのが最大のボトルネック。

### 実行手順 (管理者として PowerShell を起動)

```powershell
# 1. node_modules を除外
Add-MpPreference -ExclusionPath "C:\Users\81804\OneDrive\デスクトップ\Geek\geek-v4\node_modules"

# 2. Metro cache を除外
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Temp\metro-*"

# 3. (任意) リポジトリ全体を除外したい場合
Add-MpPreference -ExclusionPath "C:\Users\81804\OneDrive\デスクトップ\Geek\geek-v4"

# 4. Node / npm プロセス自体を除外 (ファイル open スキャンを skip)
Add-MpPreference -ExclusionProcess "node.exe"
Add-MpPreference -ExclusionProcess "npm.exe"

# 5. 除外設定を確認
Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
Get-MpPreference | Select-Object -ExpandProperty ExclusionProcess
```

### 元に戻したいとき

```powershell
Remove-MpPreference -ExclusionPath "C:\Users\81804\OneDrive\デスクトップ\Geek\geek-v4\node_modules"
Remove-MpPreference -ExclusionProcess "node.exe"
```

### セキュリティ上の注意

- node_modules は信頼できる package のみインストールしている前提 (npm audit を定期的に)。
- リポジトリ全体除外 (#3) は便利だが、ダウンロードした他人のスクリプトを誤って repo 配下に置くとスキャンされない。**`node_modules` だけの除外を推奨**。

---

## 3. OneDrive 同期から外す (★ 最も効果大)

OneDrive は `node_modules` 配下のファイル変更を逐一クラウド同期しようとして I/O を奪う。**これが Windows + Expo 環境の最大の罠**。

### 選択肢 A: リポジトリを OneDrive 外に移動 (推奨)

```powershell
# 例: C:\dev\Geek\ に移動
$src = "C:\Users\81804\OneDrive\デスクトップ\Geek"
$dst = "C:\dev\Geek"
New-Item -ItemType Directory -Force -Path "C:\dev" | Out-Null

# 1. OneDrive のオンライン保護を切ってからコピー (ファイル ロック防止)
# 2. node_modules は移動せず、新環境で npm install し直す
robocopy $src $dst /E /XD node_modules .expo dist .git\objects /XF *.log
# 3. 新場所で
cd C:\dev\Geek\geek-v4
git init   # or git clone をやり直し
npm install
```

> **これが一番効く**。OneDrive 配下である限り、Defender 除外 + watchmanconfig だけでは "速いがまだ遅い" レベル止まり。

### 選択肢 B: OneDrive で `node_modules` を選択同期から外す

ファイル エクスプローラで `geek-v4\node_modules` を **右クリック → 「常にこのデバイスに保持する」 を解除** → **「空き容量を増やす」**。

- ただし OneDrive は依然として **node_modules の変更を検知して "同期キューに積もうとする"** ので、効果は限定的。
- **選択肢 A が無理なときの妥協策**。

### 選択肢 C: OneDrive の "デスクトップ同期" 自体を切る

OneDrive 設定 → バックアップ → デスクトップのチェックを外す。
他のデスクトップファイルへの影響を考慮してから実施。

---

## 4. `.gitignore` 確認 (済)

`geek-v4/.gitignore` は以下が既に入っており、追加変更不要:

- `node_modules/` ✅
- `.expo/` ✅
- `dist/` ✅
- `.metro-health-check*` ✅

`.watchmanconfig` は **チーム共通設定なのでコミット対象** (gitignore に追加しない)。

---

## 5. 期待される改善

| 設定 | Metro cold start | hot reload | npm install |
|---|---|---|---|
| なし (現状) | 30-60s | 2-5s | 3-8 min |
| `.watchmanconfig` のみ | 25-45s | 2-4s | 3-8 min |
| `.watchmanconfig` + Defender 除外 | 15-25s | 1-2s | 1-3 min |
| 上記 + OneDrive 外へ移動 | **5-12s** | **<1s** | **30-90s** |

実測は環境差が大きい (CPU / SSD 速度 / インストール済 npm package 数) ので、**OneDrive 外移動が体感差最大**。Defender 除外と watchmanconfig は補強。

---

## 6. 確認方法 (設定後)

```powershell
# watchman 確認 (使用していれば)
watchman watch-list

# Metro のキャッシュをクリアして再起動
cd C:\Users\81804\OneDrive\デスクトップ\Geek\geek-v4
npm start -- --reset-cache

# 初回 transform 完了までの時間を計測
```

---

## 7. ロールバック手順

| 設定 | 戻し方 |
|---|---|
| `.watchmanconfig` | `git rm .watchmanconfig` |
| Defender 除外 | `Remove-MpPreference -ExclusionPath ...` (上記 § 2) |
| OneDrive 外移動 | リポジトリを元の場所に robocopy で戻す |
