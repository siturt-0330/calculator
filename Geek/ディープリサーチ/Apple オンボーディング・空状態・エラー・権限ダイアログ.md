# Apple オンボーディング・空状態・エラー・権限ダイアログ

> Apple の流儀は **「一画面一目的、装飾は控えめ、原因と次のアクションを平易に」**。Onboarding は **最小限の情報** で本機能に到達、Empty state は **装飾より content の不在を肯定する**、Error は **何が起きたか + 次にどうするか**、Permission は **使う直前に求める** が四本柱。
> 出典: HIG Onboarding、HIG Alerts、HIG Privacy、HIG Empty State、Apple Design Tips

---

## 1. 一文要約

> **「ユーザーに余計な学習・装飾・技術用語・無駄な確認を強いない」** が Apple の対人原則。Onboarding/Empty/Error/Permission の四場面はとくに守る。

---

## 2. Onboarding (オンボーディング)

### 2.1 原則

> Onboarding を **「アプリの本機能を遅らせる障害物」にしない**

Apple HIG は明確に「optional steps」「skip」を許す設計を推奨。

### 2.2 7 つのルール

1. **3 画面以内** に収める (理想は 0 画面、必要なら 1–3)
2. **skip ボタンを常時可視** にする (右上 or 下)
3. **アカウント作成を遅らせる** — 機能を試してからサインアップ
4. **権限要求は実際に必要な時** (起動直後の連発禁止)
5. **チュートリアルではなく試させる** — 「いいねを押してみよう」より「いいねを押したら何が起きる」を実体験
6. **swipe ナビゲーション** + **ページ indicator**
7. **戻れる** — 1 画面前へ戻れる動線

### 2.3 アンチパターン

- ❌ 起動直後に 5 画面のチュートリアル
- ❌ skip 不可
- ❌ 権限要求の連発 (通知 + 位置情報 + カメラ + 連絡先)
- ❌ アカウント作成必須 (本機能を覗かせない)

### 2.4 GEEK の選択

GEEK は **オンボーディング廃止** (memory: [[project_geek_onboarding_removal]])。
- 登録は email + password のみ
- nickname は匿名ランダム (`user_8hex`)
- 初回起動 → splash → そのままフィード

→ Apple HIG の理想「0 画面 onboarding」に到達。

---

## 3. Empty State (空状態)

### 3.1 原則

> Empty state は **「失敗」ではなく「これから何かが起きる場所」**

装飾より content の不在を肯定。1 つの CTA で次の動線へ。

### 3.2 構成 (HIG 推奨)

```
[Icon or Illustration]
   ↓ (16-24pt 空間)
Title (Headline 17 Semibold)
   ↓ (8pt)
Body (Body 17 Regular, 中立な説明)
   ↓ (24pt)
[Primary CTA Button]
```

### 3.3 数値ルール

| 要素 | 値 |
|---|---|
| Icon サイズ | 80–96pt |
| Icon と Title 間 | 16–24pt |
| Title と Body 間 | 8pt |
| Body と CTA 間 | 24pt |
| 全体の上下中央配置 | flex: 1, justifyContent: 'center' |

### 3.4 文言の原則

- ❌「データがありません」(否定形)
- ✅「最初の投稿をしてみよう」(肯定形・行動誘発)

- ❌「ご利用いただけません」
- ✅「未参加コミュニティの投稿はありません — 『すべて』に切り替えるか、検索で新しいコミュニティを探してみよう」

### 3.5 アンチパターン

- ❌ 装飾的すぎる illustration (主役が画面の不在になってしまう)
- ❌ 複数の CTA (1 つに絞る)
- ❌ 技術的な原因 ("HTTP 404") を表示

---

## 4. Error (エラー)

### 4.1 原則

> エラーは **「何が起きたか + 次にどうするか」** を平易な日本語で。

技術用語 / stack trace / 英文を本番でユーザーに見せない。

### 4.2 構成

```
[Icon (warning, exclamation)]
   ↓
Title — 何が起きたか (1 行)
   ↓
Body — なぜ起きたか + 解決策 (1–2 文)
   ↓
[Retry] [Cancel]
```

### 4.3 文言の原則

| ❌ | ✅ |
|---|---|
| Network request failed | 通信できませんでした。電波の良い場所でもう一度お試しください |
| Error: 500 | サーバーで一時的な問題が発生しました。しばらく経ってからお試しください |
| Validation error: email required | メールアドレスを入力してください |
| Permission denied | 写真へのアクセスを許可してください。設定 > GEEK > 写真 から変更できます |

### 4.4 ErrorBoundary の作法

dev では stack trace、本番では汎用文言:

```tsx
class ErrorBoundary extends React.Component {
  render() {
    if (this.state.error) {
      return (
        <View>
          <Icon name="exclamationmark.triangle" />
          <Text style={T.headline}>問題が発生しました</Text>
          <Text style={T.body}>もう一度お試しいただくか、解消しない場合はお問い合わせからご連絡ください</Text>
          {__DEV__ && (
            <Text style={T.caption} style={{ color: C.text3 }}>{this.state.error.message}</Text>
          )}
          <Button title="再読み込み" onPress={this.reset} />
        </View>
      );
    }
    return this.props.children;
  }
}
```

### 4.5 toast vs alert vs banner vs page

| 種類 | 使い分け |
|---|---|
| **Toast** (3 秒消失) | 成功 / 軽い情報 ("コピーしました") |
| **Alert** (dialog) | 確認が必要 / blocking ("削除しますか？") |
| **Banner** (画面上端) | 持続的なエラー ("通信が不安定です") |
| **Page** (full screen) | 致命的エラー ("接続できません" + 再試行) |

---

## 5. Permission Dialog (権限ダイアログ)

### 5.1 原則

> 権限は **使う直前に求める**。理由を明示する。拒否されたら丁寧に救済する。

### 5.2 タイミング

- ❌ 起動直後に全権限を request (連発)
- ✅ 機能を使おうとした瞬間に request

例: 写真投稿
1. ユーザーが「写真を選ぶ」を tap
2. **その瞬間** に写真アクセス request
3. 拒否されたら「設定で許可できます」UI + deep link

### 5.3 NSXxxUsageDescription の文言

Info.plist (iOS) の説明文は **「なぜ必要か」+「何ができるようになるか」**:

```
NSPhotoLibraryUsageDescription:
"写真ライブラリへのアクセスを許可すると、投稿に画像を添付できるようになります"
```

審査で **「曖昧な説明」は reject**:
- ❌ "App needs photo access"
- ✅ "投稿に画像を添付するために写真ライブラリへのアクセスが必要です"

### 5.4 拒否後の救済 UI

```tsx
import { Linking } from 'react-native';

if (permission.status === 'denied') {
  return (
    <View>
      <Icon name="lock" />
      <Text style={T.headline}>写真へのアクセスが必要です</Text>
      <Text style={T.body}>設定で写真ライブラリへのアクセスを許可してください</Text>
      <Button title="設定を開く" onPress={() => Linking.openSettings()} />
    </View>
  );
}
```

`Linking.openSettings()` で iOS Settings の GEEK 該当ページに直接遷移。

### 5.5 GEEK が request する権限と文言

| 権限 | タイミング | NSXxxUsageDescription |
|---|---|---|
| 写真ライブラリ | 投稿で「写真を選ぶ」tap 時 | 投稿に画像を添付するために写真ライブラリへのアクセスが必要です |
| カメラ | 投稿で「カメラで撮る」tap 時 | 投稿用の写真を撮影するためにカメラへのアクセスが必要です |
| 通知 | 「通知を有効にする」tap 時 | 新しいコメントやいいねをお知らせするために通知が必要です |
| 位置情報 (任意) | 「近くのコミュニティを探す」tap 時 | あなたの近くのコミュニティを表示するために位置情報が必要です |
| マイク (将来) | 音声投稿開始時 | 音声投稿の録音にマイクが必要です |

---

## 6. Confirmation Dialog (確認ダイアログ)

### 6.1 ボタン配置

**iOS 標準**: 横並び、cancel 左 / confirm 右
**Material 標準**: 横並び、cancel 左 / confirm 右 (両者一致)

```
[Cancel]   [Delete]
   左         右
```

3 つ以上は縦並び (上から最も destructive、下が cancel)。

### 6.2 destructive の表現

destructive action は **赤** (`systemRed`) で:
```tsx
<Button title="削除" textColor={C.red} fontWeight="600" />
```

### 6.3 文言

- Title: 1 行で何をするか ("この投稿を削除しますか？")
- Body: 影響を明示 ("削除すると元に戻せません")
- Cancel: "キャンセル" or "やめる"
- Confirm: 動詞 ("削除する") — "OK" 禁止

---

## 7. GEEK にどう活かすか

### 7.1 強み (audit より)

✅ **オンボーディング廃止**: HIG 理想「0 画面 onboarding」を実装済 ([[project_geek_onboarding_removal]])
✅ **匿名ニックネーム**: ランダム `user_8hex` で psychological safety を担保
✅ **PolishedButton スタンプピッカー**: 美しい empty state 候補

### 7.2 P0 — ErrorBoundary が raw error 露出

**現状** (`components/ui/ErrorBoundary.tsx:72-74`):
```tsx
<Text style={[T.caption, ...]}>{this.state.error.message}</Text>
```

本番で英文 stack / Supabase エラー / "Network request failed" がユーザーに直接到達。
**HIG 違反**: understandable でない、平易な日本語でない。

**修正**:
```tsx
<Text style={[T.body, { color: C.text }]}>
  もう一度お試しいただくか、解消しない場合はお問い合わせからご連絡ください
</Text>
{__DEV__ && (
  <Text style={[T.caption, { color: C.text3, marginTop: 8 }]}>
    {this.state.error.message}
  </Text>
)}
```

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §3 P0-1)

### 7.3 P1 — Empty state 4 系統 → 2 系統に統合

**現状** (audit より):
- `EmptyState` (96×96 gradient halo)
- `ErrorState`
- `ErrorBoundary`
- `PolishedEmpty` (BBS 用)
- `CommunityPolishedEmpty`
- `EditorialEmpty` (検索結果ゼロ)

→ **6 系統並立** で実装重複。

**改善案**:
- 汎用 `EmptyState` に統合 (`tone` prop を生かす案 A、削除する案 B)
- Editorial 系 (`PolishedEmpty` / `EditorialEmpty`) は brand identity 上残す
- `CommunityPolishedEmpty` は `EmptyState` に吸収

### 7.4 P1 — Permission 拒否後の救済 UI

`settings/notifications.tsx` + `PushNotificationToggle.tsx` に:
```tsx
import { Linking } from 'react-native';

{permissionStatus === 'denied' && (
  <Button
    title="設定アプリを開く"
    onPress={() => Linking.openSettings()}
  />
)}
```

### 7.5 P2 — ConfirmDialog を iOS 横並び化

現状は縦並び。iOS 標準は **横並び (cancel 左 / confirm 右)**。
3 ボタン以上は縦並びにフォールバック。destructive 時のみ confirm を bold。

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §4 Phase 2-5)

### 7.6 文言レビュー — 既存の error を「平易な日本語」に

audit で発見された改善余地:
- 通信エラー → 「通信できませんでした。電波の良い場所でもう一度お試しください」
- Supabase RLS 403 → 「この操作を行う権限がありません」
- バリデーション → 各フィールドで「○○を入力してください」

→ `lib/errors/messages.ts` に semantic message map を新設、エラーコード → 日本語文言で集約。

---

## 8. オンボーディング不要時代の "首回し"

オンボーディングを廃止する代わりに **状況依存の hint** を入れる:
- フィードを 3 行 scroll した時に「いいねは🤍をタップ」(toast)
- 投稿成功時に「コメントは投稿詳細から書けます」(toast)
- コミュニティ参加時に「参加したコミュニティの投稿だけ見るには」(toast)

→ 「**学ばせるのではなく試させる**」の体現。

---

## 9. 文言ルールまとめ

| 場面 | 良い文言 |
|---|---|
| Empty (フィード) | 「最初の投稿をしてみよう」 |
| Empty (検索結果ゼロ) | 「条件に合う投稿は見つかりませんでした。別のキーワードで試してみよう」 |
| Empty (通知ゼロ) | 「まだ通知はありません。投稿やコメントがあるとここに表示されます」 |
| Empty (コミュニティゼロ) | 「コミュニティを探して参加してみよう」 |
| Error (通信) | 「通信できませんでした。電波の良い場所でもう一度お試しください」 |
| Error (権限) | 「写真へのアクセスを許可してください。設定 > GEEK > 写真 から変更できます」 |
| Error (汎用) | 「もう一度お試しいただくか、解消しない場合はお問い合わせからご連絡ください」 |
| Confirm (delete) | Title: 「この投稿を削除しますか？」 / Body: 「削除すると元に戻せません」 / Buttons: 「キャンセル」「削除する」 |
| Confirm (block) | Title: 「このユーザーをブロックしますか？」 / Body: 「ブロックすると投稿や通知が表示されなくなります」 / Buttons: 「キャンセル」「ブロックする」 |
| Permission (写真) | NSPhotoLibraryUsageDescription: 「投稿に画像を添付するために写真ライブラリへのアクセスが必要です」 |

---

## 10. 出典

- **HIG Onboarding** — https://developer.apple.com/design/human-interface-guidelines/onboarding
- **HIG Alerts** — https://developer.apple.com/design/human-interface-guidelines/alerts
- **HIG Privacy** — https://developer.apple.com/design/human-interface-guidelines/privacy
- **HIG Loading** — https://developer.apple.com/design/human-interface-guidelines/loading
- **App Store Review Guidelines** — https://developer.apple.com/app-store/review/guidelines/

---

## 関連ノート

- [[Apple HIG 総論 — 二層原則 (WWDC17・WWDC26)]] — Feedback / Responsibility 原則の実装
- [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] — Permission 文言は審査基準
- [[Apple Typography — SF Pro と Dynamic Type]] — Empty/Error の文字スケール
- [[GEEK × Apple HIG 監査レポート 2026-06]] — empty-error 監査結果
