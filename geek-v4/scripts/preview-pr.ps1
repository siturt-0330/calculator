# ============================================================
# preview-pr.ps1 — ローカルで特定 PR の branch に切り替える
# ============================================================
# 目的:
#   #94〜#99 の 6 PR を個別 / 一括でローカル preview 検証するための
#   safe switcher. 絶対に git push しない / Netlify を trigger しない.
#
# 使い方:
#   .\scripts\preview-pr.ps1 -PR 94        # i18n settings (#94)
#   .\scripts\preview-pr.ps1 -PR 95        # ジャンル別タブ (#95)
#   .\scripts\preview-pr.ps1 -PR all       # 6 PR 全部 merge した preview
#
# 切替後は Metro を再起動してください:
#   npx expo start --web --port 8081                 ← 通常はこちら (FileStore キャッシュを使う = 高速)
#   npx expo start --web --port 8081 --clear         ← キャッシュ汚染が疑われるときだけ (再 transform で遅い)
#
# metro.config.js に FileStore を設定済みなので、2 回目以降の起動は
# .metro-cache/ に残った transform 結果を再利用して大幅に高速化される。
# --clear を毎回付けるとこのキャッシュを毎回捨てることになり遅くなる。
# ============================================================
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('94','95','96','97','98','99','all','back')]
  [string]$PR
)

$ErrorActionPreference = 'Stop'

# PR → branch マッピング (このコメントは固定 = 過去に存在を確認済み)
$branchMap = @{
  '94'   = 'fix/i18n-settings-language-decouple'      # i18n settings
  '95'   = 'feat/community-genre-tabs'                # ジャンル別タブ
  '96'   = 'feat/trust-score-friendly-labels'         # 信頼度肩書
  '97'   = 'feat/post-detail-reactions'               # 投稿詳細リアクション
  '98'   = 'refactor/official-shrink-to-geek-only'    # 公式 shrink
  '99'   = 'feat/i18n-dict-expansion-d'               # i18n D
  'all'  = 'preview/verify-all-prs'                   # 6 PR 全部 merge
  'back' = 'feat/community-mods'                      # polish 作業 branch に戻る
}

$labelMap = @{
  '94'   = '#94 i18n settings'
  '95'   = '#95 ジャンル別タブ'
  '96'   = '#96 信頼度肩書'
  '97'   = '#97 投稿詳細リアクション'
  '98'   = '#98 公式 shrink'
  '99'   = '#99 i18n D'
  'all'  = '6 PR 全部 merge (preview/verify-all-prs)'
  'back' = 'polish 作業 branch に戻る (feat/community-mods)'
}

$branch = $branchMap[$PR]
$label  = $labelMap[$PR]

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Preview switch: $label" -ForegroundColor Cyan
Write-Host " branch: $branch" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Safety: working tree clean check
$status = git status --porcelain
if ($status) {
  Write-Host "[WARN] 未コミットの変更があります:" -ForegroundColor Yellow
  git status --short
  Write-Host ""
  $confirm = Read-Host "このまま switch しますか? (y/N)"
  if ($confirm -ne 'y') {
    Write-Host "中止しました。" -ForegroundColor Yellow
    exit 0
  }
}

# Switch
git switch $branch
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] git switch に失敗しました" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "[OK] $branch に切り替えました" -ForegroundColor Green
Write-Host ""
Write-Host "次のステップ:" -ForegroundColor Cyan
Write-Host "  1. Metro が起動中の場合は Ctrl+C で停止" -ForegroundColor White
Write-Host "  2. npx expo start --web --port 8081" -ForegroundColor White
Write-Host "     (キャッシュ汚染が疑われるときだけ --clear を追加)" -ForegroundColor DarkGray
Write-Host "  3. http://localhost:8081 をブラウザで開く" -ForegroundColor White
Write-Host ""
Write-Host "[!] このスクリプトは絶対に git push しません。" -ForegroundColor Yellow
Write-Host "[!] Netlify には絶対反映されません。" -ForegroundColor Yellow
Write-Host ""
