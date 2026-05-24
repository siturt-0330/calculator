# Store Review Notes — App Store / Google Play 提出用メモ

App Store Connect / Play Console の「審査メモ (Review Notes)」欄にコピペするためのテンプレ。
日本語審査と英語審査の両方に対応できるよう、英訳を併記。

---

## 1. テストアカウント (Demo Account)

審査チームが機能を一通り試せるアカウントを 1 つ常に有効に保つ。

```
Email:    demo+review@geek.app
Password: <REDACTED — see 1Password "GEEK Store Reviewer">
```

**必ず更新するタイミング**:
- バージョン提出のたびに password を rotate (リーク防止)
- 信頼スコアが下がった場合は新しいアカウントを発行 (機能制限を避ける)

---

## 2. デモフロー (Reviewer Walkthrough)

審査担当者が 5 分以内にアプリの主要機能を確認できるよう、推奨フロー:

### 日本語

1. ログイン (上記アカウント)
2. ホームタブで feed をスクロール、テキストスタンプを 1 つタップ
3. 投稿の写真をタップで全画面プレビュー、ピンチで拡大
4. コミュニティタブから任意のコミュニティを開き、参加 → 投稿
5. マイページから「データをエクスポート」を実行 (GDPR/個人情報保護法対応)
6. 設定 → アカウント → 「アカウントを削除」までフロー確認 (実行はしない)

### English

1. Log in with the demo account above
2. On the Home tab, scroll the feed and tap any text-stamp chip
3. Tap a post photo for fullscreen preview, pinch to zoom
4. Open the Community tab, join any community, then post
5. From the Profile tab tap "Export my data" (GDPR / Japan PIPA compliance)
6. Settings → Account → "Delete account" — confirm the flow is reachable (do not execute)

---

## 3. プライバシーラベル / Privacy Nutrition Labels (App Store)

App Store Connect → App Privacy で以下を申告。

### Data Linked to You

| Data Type | Used For |
|---|---|
| Email Address | App Functionality (auth) |
| User ID | App Functionality (internal) |
| Photos | App Functionality (post upload) |

### Data Not Linked to You

| Data Type | Used For |
|---|---|
| Crash Data | App Functionality (Sentry) |
| Performance Data | App Functionality (Sentry) |

### Data Used to Track You

**None.** GEEK does not track users across apps/websites. Advertising is tag-based (no personal ID sent to advertisers); see Privacy Policy section 5.

### App Tracking Transparency (ATT)

ATT prompt は表示しない。`NSUserTrackingUsageDescription` も含めない。
(`app.json` の `ios.privacyManifests.NSPrivacyTracking: false` と整合)

---

## 4. Age Rating

| Item | Answer |
|---|---|
| Unrestricted Web Access | No (in-app browser のみ) |
| Gambling | No |
| Mature/Suggestive Themes | Infrequent/Mild (NSFW タグ付き投稿は CW (Content Warning) でブラー表示) |
| Profanity or Crude Humor | Infrequent/Mild (匿名 SNS の性質上) |
| Sexual Content | None / Infrequent (NSFW は CW + opt-in) |
| Horror/Fear | No |
| Realistic Violence | No |
| User Generated Content | **Yes** — モデレーション体制を別途記載 (下記 §5) |

**iOS rating: 12+ を想定。Google Play: Teen 想定。**

---

## 5. User Generated Content モデレーション体制

審査で「UGC をどう統制しているか」を必ず問われる。以下を回答テンプレに:

> GEEK applies multi-layered moderation:
> 1. **AI pre-scan**: Every post is scanned by an Edge Function (`check-content`) for personal info, hate speech, and spam patterns before publication.
> 2. **Trust score system**: Users with low trust scores have reduced posting frequency and visibility (see Specification §16).
> 3. **In-app reporting**: Every post has a "Report" affordance reachable in 2 taps. Reports flow to `reports` table and trigger admin review within 24h.
> 4. **Block & filter**: Users can block other users, mute tags, and enable CW for sensitive content.
> 5. **Tag filtering**: Gossip / scandal tags are excluded from trending regardless of user setting.
> 6. **EFFC compliance**: Reports of CSAM are escalated immediately; we comply with applicable Japanese/EU law.

---

## 6. Export Compliance (iOS のみ)

- `ITSAppUsesNonExemptEncryption: false` を `app.json` で宣言済み。
- 使用している暗号は HTTPS / TLS / iOS 標準の Keychain (expo-secure-store) のみ。
- 米国 EAR ENC 申告は不要 (Apple exempt category 5A992)。

---

## 7. 著作権 / DMCA / 日本の著作権法

`app/settings/terms.tsx` 第11条 (お問い合わせ・著作権侵害申立) に記載。
申立窓口: `copyright@geek.app` (Subject に "DMCA Notice" or "著作権侵害通知" を含めること)。

---

## 8. Reviewer 用 追加情報 (任意)

- アプリは **完全匿名 SNS** です。投稿者名 (ニックネーム) は本人のみ閲覧可能で、他ユーザーには「匿」表示されます。
- ユーザー間 DM 機能は **ありません** (荒らし・スパムの導線を最初から作らない設計)。
- 17 歳未満のユーザーは保護者同意を前提とし、Account 作成時に年齢確認ステップがあります。

---

## 9. Privacy Policy / Terms URL

App Store / Play Store の必須リンク欄に下記を貼る:

- Privacy Policy: `https://geek.app/privacy` (or in-app: Settings → プライバシーポリシー)
- Terms of Use: `https://geek.app/terms` (or in-app: Settings → 利用規約)

**注**: in-app 表示しかない場合、ストア審査で web 版 URL を求められる。
`geek-intro` ランディング側で `/privacy` `/terms` を立てておくこと。
